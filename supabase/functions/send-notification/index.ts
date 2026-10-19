import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  authorizeFeedbackEmail,
  authorizeGradesPostedCaller,
  authorizeRiskFeedbackEmail,
  deliverEmail,
  emailLogKey,
  engagementInterventionRecipient,
  enrollmentInstructors,
  gradesPostedEmail,
  gradesPostedLogId,
  instructorFeedbackEmail,
  interventionStudentEmail,
  loggedInterventionRecipient,
  omitLoggedGradesPostedLines,
  responsibleFeedbackInstructor,
  riskFeedbackEmail,
  riskFeedbackInstructor,
  selectGradesPostedLines,
} from "../_shared/notification-channels.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type RiskLevel = "critical" | "at_risk" | "stable" | "excelling";

function normalizeEmail(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  return trimmed;
}

function safeString(s: unknown): string | null {
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

function safeRiskLevel(s: unknown): RiskLevel | null {
  if (s === "critical" || s === "at_risk" || s === "stable" || s === "excelling") return s;
  return null;
}

async function sendBrevoEmail(opts: { to: string; subject: string; html: string }) {
  const brevoKey = Deno.env.get("BREVO_API_KEY");
  if (!brevoKey) throw new Error("Email not configured. Add BREVO_API_KEY to Edge Function secrets.");

  const fromRaw = Deno.env.get("BREVO_FROM") || "EDGE <noreply@example.com>";
  const match = fromRaw.match(/^(.*)<(.+)>$/);
  const fromName = match ? match[1].trim() : "EDGE";
  const fromEmail = match ? match[2].trim() : fromRaw;

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": brevoKey,
    },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      to: [{ email: opts.to }],
      subject: opts.subject,
      htmlContent: opts.html,
    }),
  });

  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (result && (result.message || result.error)) ? (result.message || result.error) : `Brevo error (${res.status})`;
    throw new Error(msg);
  }
  return result as { messageId?: string };
}

async function sendBrevoBatch(emails: Array<{ to: string; subject: string; html: string }>) {
  const results: { index: number; success: boolean; error?: string }[] = [];

  for (let i = 0; i < emails.length; i++) {
    const e = emails[i];
    try {
      await sendBrevoEmail(e);
      results.push({ index: i, success: true });
    } catch (err) {
      results.push({ index: i, success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const data = results.filter((r) => r.success).map(() => ({ id: crypto.randomUUID ? crypto.randomUUID() : "" }));
  const errors = results
    .filter((r) => !r.success)
    .map((r) => ({ index: r.index, message: r.error || "Unknown error" }));

  return { data, errors } as {
    data?: Array<{ id: string }>;
    errors?: Array<{ index: number; message: string }>;
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sendGradesPostedEmail(
  supabase: ReturnType<typeof createClient>,
  callerId: string,
  subjectId: string | null,
  itemsRaw: unknown,
) {
  if (!subjectId) throw new Error("subject_id is required");
  const items = Array.isArray(itemsRaw)
    ? itemsRaw
      .map((row) => {
        const record = row && typeof row === "object" ? row as Record<string, unknown> : null;
        return {
          activityId: safeString(record?.activity_id) ?? "",
          studentId: safeString(record?.student_id) ?? "",
        };
      })
      .filter((row) => row.activityId && row.studentId)
    : [];
  if (items.length === 0) throw new Error("items are required");

  const { data: roleCheck } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", callerId)
    .eq("role", "instructor")
    .maybeSingle();

  const { data: subject, error: subjectError } = await supabase
    .from("subjects")
    .select("id, code, instructor_id")
    .eq("id", subjectId)
    .maybeSingle();
  if (subjectError) throw subjectError;
  if (!authorizeGradesPostedCaller({
    callerIsInstructor: Boolean(roleCheck),
    callerId,
    subjectInstructorId: subject?.instructor_id ?? null,
  })) {
    throw new Error("Not allowed");
  }

  const activityIds = [...new Set(items.map((item) => item.activityId))];
  const { data: activities, error: activitiesError } = await supabase
    .from("activities")
    .select("id, title, subject_id")
    .in("id", activityIds);
  if (activitiesError) throw activitiesError;

  const activitySubjectId = new Map<string, string>();
  const titleByActivityId = new Map<string, string>();
  for (const activity of activities ?? []) {
    activitySubjectId.set(activity.id, activity.subject_id);
    titleByActivityId.set(activity.id, activity.title);
  }

  const { data: submissions, error: submissionsError } = await supabase
    .from("submissions")
    .select("activity_id, student_id, score")
    .in("activity_id", activityIds);
  if (submissionsError) throw submissionsError;

  const scoreByPair = new Map<string, number | null>();
  for (const row of submissions ?? []) {
    if (!row.activity_id || !row.student_id) continue;
    scoreByPair.set(gradesPostedLogId(row.activity_id, row.student_id), row.score);
  }

  const lines = selectGradesPostedLines({
    items,
    activitySubjectId,
    subjectId,
    scoreByPair,
    titleByActivityId,
  });
  if (lines.length === 0) {
    return json({ success: true, sent: 0, failed: 0, skipped: "no_recorded_score" });
  }

  const byStudent = new Map<string, typeof lines>();
  for (const line of lines) {
    const existing = byStudent.get(line.studentId) ?? [];
    existing.push(line);
    byStudent.set(line.studentId, existing);
  }

  let sent = 0;
  let failed = 0;
  let duplicates = 0;

  for (const [studentId, studentLines] of byStudent) {
    const loggedPairKeys = new Set<string>();
    for (const line of studentLines) {
      const logKey = emailLogKey("grades_posted", gradesPostedLogId(line.activityId, studentId));
      const { data: existing } = await supabase
        .from("email_notifications")
        .select("id")
        .eq("student_id", studentId)
        .eq("risk_level", logKey)
        .limit(1);
      if ((existing ?? []).length > 0) {
        loggedPairKeys.add(gradesPostedLogId(line.activityId, studentId));
      }
    }
    const pending = omitLoggedGradesPostedLines(studentLines, loggedPairKeys);
    duplicates += studentLines.length - pending.length;
    if (pending.length === 0) continue;

    const { data: profile } = await supabase
      .from("profiles")
      .select("email")
      .eq("user_id", studentId)
      .maybeSingle();
    const to = normalizeEmail(profile?.email);
    if (!to) {
      failed += 1;
      continue;
    }

    const email = gradesPostedEmail(
      subject?.code,
      pending.map((line) => ({ title: line.title, score: line.score })),
    );
    const delivery = await deliverEmail({
      alreadyLogged: false,
      send: () => sendBrevoEmail({ to, subject: email.subject, html: email.html }),
      log: async () => {
        const rows = pending.map((line) => ({
          student_id: studentId,
          subject_id: subjectId,
          risk_level: emailLogKey("grades_posted", gradesPostedLogId(line.activityId, studentId)),
          channel: "email",
        }));
        const { error: logError } = await supabase.from("email_notifications").insert(rows);
        if (logError) throw logError;
      },
    });
    if (delivery === "failed") failed += 1;
    else if (delivery === "duplicate") duplicates += pending.length;
    else sent += 1;
  }

  return json({
    success: true,
    sent,
    failed,
    duplicate: duplicates > 0 && sent === 0 && failed === 0,
  });
}

async function sendRiskFeedbackEmail(
  supabase: ReturnType<typeof createClient>,
  callerId: string,
  feedbackId: string | null,
) {
  if (!feedbackId) throw new Error("feedback_id is required");

  const { data: studentRole } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", callerId)
    .eq("role", "student")
    .maybeSingle();

  const { data: feedback, error: feedbackError } = await supabase
    .from("student_feedback")
    .select("id, student_id, subject_id")
    .eq("id", feedbackId)
    .maybeSingle();
  if (feedbackError) throw feedbackError;

  const authorized = authorizeRiskFeedbackEmail({
    callerId,
    callerRole: studentRole?.role ?? null,
    feedback: feedback
      ? { studentId: feedback.student_id, subjectId: feedback.subject_id }
      : null,
  });
  if (!authorized) throw new Error("Not allowed");

  const { data: subject, error: subjectError } = await supabase
    .from("subjects")
    .select("id, code, instructor_id")
    .eq("id", authorized.subjectId)
    .maybeSingle();
  if (subjectError) throw subjectError;

  const instructorId = riskFeedbackInstructor(subject?.instructor_id);
  if (!instructorId) return json({ success: true, sent: 0, failed: 0, skipped: "no_instructor" });

  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, email, full_name")
    .in("user_id", [authorized.studentId, instructorId]);
  const instructor = profiles?.find((profile) => profile.user_id === instructorId);
  const student = profiles?.find((profile) => profile.user_id === authorized.studentId);
  const instructorEmail = normalizeEmail(instructor?.email);
  if (!instructorEmail) return json({ success: true, sent: 0, failed: 0, skipped: "no_email" });

  const logKey = emailLogKey("risk_feedback", feedbackId);
  const { data: existing } = await supabase
    .from("email_notifications")
    .select("id")
    .eq("student_id", authorized.studentId)
    .eq("risk_level", logKey)
    .limit(1);
  const email = riskFeedbackEmail({
    studentName: student?.full_name,
    subjectCode: subject?.code,
  });
  const delivery = await deliverEmail({
    alreadyLogged: (existing ?? []).length > 0,
    send: () => sendBrevoEmail({ to: instructorEmail, subject: email.subject, html: email.html }),
    log: async () => {
      const { error: logError } = await supabase.from("email_notifications").insert({
        student_id: authorized.studentId,
        subject_id: authorized.subjectId,
        risk_level: logKey,
        channel: "email",
      });
      if (logError) throw logError;
    },
  });

  if (delivery === "failed") return json({ success: true, sent: 0, failed: 1 });
  if (delivery === "duplicate") return json({ success: true, sent: 0, failed: 0, duplicate: true });
  return json({ success: true, sent: 1, failed: 0 });
}

async function sendInstructorFeedbackEmail(
  supabase: ReturnType<typeof createClient>,
  callerId: string,
  feedbackId: string | null,
) {
  if (!feedbackId) throw new Error("feedback_id is required");

  const { data: studentRole } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", callerId)
    .eq("role", "student")
    .maybeSingle();

  const { data: feedback, error: feedbackError } = await supabase
    .from("student_engagement_feedback")
    .select("id, student_id, subject")
    .eq("id", feedbackId)
    .maybeSingle();
  if (feedbackError) throw feedbackError;

  const authorized = authorizeFeedbackEmail({
    callerId,
    callerRole: studentRole?.role ?? null,
    feedback: feedback ? { studentId: feedback.student_id, topic: feedback.subject } : null,
  });
  if (!authorized) throw new Error("Not allowed");

  const { data: enrollmentRows, error: enrollmentError } = await supabase
    .from("enrollments")
    .select("subjects(instructor_id, code, name)")
    .eq("student_id", authorized.studentId)
    .eq("status", "active");
  if (enrollmentError) throw enrollmentError;

  const instructorId = responsibleFeedbackInstructor(
    authorized.topic,
    enrollmentInstructors(enrollmentRows ?? []),
  );
  if (!instructorId) return json({ success: true, sent: 0, failed: 0, skipped: "ambiguous_instructor" });

  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, email, full_name")
    .in("user_id", [authorized.studentId, instructorId]);
  const instructor = profiles?.find((profile) => profile.user_id === instructorId);
  const student = profiles?.find((profile) => profile.user_id === authorized.studentId);
  const instructorEmail = normalizeEmail(instructor?.email);
  const studentName = student?.full_name?.trim() || "A student";
  const topic = authorized.topic?.trim() || "general feedback";
  const dedupeKey = `engagement-feedback:${feedback.id}`;
  const { data: existingInbox } = await supabase
    .from("user_inbox_notifications")
    .select("id")
    .eq("user_id", instructorId)
    .eq("dedupe_key", dedupeKey)
    .limit(1);
  if ((existingInbox ?? []).length === 0) {
    const { error: inboxError } = await supabase.from("user_inbox_notifications").insert({
      user_id: instructorId,
      title: "New student feedback",
      body: `${studentName} submitted new feedback: ${topic}.`,
      source_name: studentName,
      dedupe_key: dedupeKey,
    });
    if (inboxError && inboxError.code !== "23505") throw inboxError;
  }
  if (!instructorEmail) return json({ success: true, sent: 0, failed: 0, skipped: "no_email" });

  const logKey = emailLogKey("instructor_feedback", feedback.id);
  const { data: existing } = await supabase
    .from("email_notifications")
    .select("id")
    .eq("student_id", authorized.studentId)
    .eq("risk_level", logKey)
    .limit(1);
  const email = instructorFeedbackEmail({
    studentName: student?.full_name,
    topic: authorized.topic,
  });
  const delivery = await deliverEmail({
    alreadyLogged: (existing ?? []).length > 0,
    send: () => sendBrevoEmail({ to: instructorEmail, subject: email.subject, html: email.html }),
    log: async () => {
      const { error: logError } = await supabase.from("email_notifications").insert({
        student_id: authorized.studentId,
        risk_level: logKey,
        channel: "email",
      });
      if (logError) throw logError;
    },
  });

  if (delivery === "failed") return json({ success: true, sent: 0, failed: 1 });
  if (delivery === "duplicate") return json({ success: true, sent: 0, failed: 0, duplicate: true });
  return json({ success: true, sent: 1, failed: 0 });
}

async function sendEngagementInterventionEmail(
  supabase: ReturnType<typeof createClient>,
  callerId: string,
  interventionId: string | null,
) {
  if (!interventionId) throw new Error("intervention_id is required");

  const { data: roleCheck } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", callerId)
    .eq("role", "instructor")
    .maybeSingle();

  const { data: intervention, error: interventionError } = await supabase
    .from("engagement_interventions")
    .select("id, student_id, instructor_id, action_type, subject_id")
    .eq("id", interventionId)
    .maybeSingle();
  if (interventionError) throw interventionError;

  const studentId = engagementInterventionRecipient({
    callerIsInstructor: Boolean(roleCheck),
    callerId,
    intervention: intervention
      ? {
        studentId: intervention.student_id,
        instructorId: intervention.instructor_id,
        actionType: intervention.action_type,
      }
      : null,
  });
  if (!studentId) throw new Error("Not allowed");

  const { data: studentProfile } = await supabase
    .from("profiles")
    .select("email")
    .eq("user_id", studentId)
    .maybeSingle();
  const studentEmail = normalizeEmail(studentProfile?.email);
  if (!studentEmail) return json({ success: true, sent: 0, failed: 0, skipped: "no_email" });

  let subjectCode: string | null = null;
  if (intervention?.subject_id) {
    const { data: subject } = await supabase
      .from("subjects")
      .select("code")
      .eq("id", intervention.subject_id)
      .maybeSingle();
    subjectCode = subject?.code ?? null;
  }

  const logKey = emailLogKey("engagement_intervention", interventionId);
  const { data: existing } = await supabase
    .from("email_notifications")
    .select("id")
    .eq("student_id", studentId)
    .eq("risk_level", logKey)
    .limit(1);
  const email = interventionStudentEmail(subjectCode);
  const delivery = await deliverEmail({
    alreadyLogged: (existing ?? []).length > 0,
    send: () => sendBrevoEmail({ to: studentEmail, subject: email.subject, html: email.html }),
    log: async () => {
      const { error: logError } = await supabase.from("email_notifications").insert({
        student_id: studentId,
        subject_id: intervention?.subject_id ?? null,
        risk_level: logKey,
        channel: "email",
      });
      if (logError) throw logError;
    },
  });

  if (delivery === "failed") return json({ success: true, sent: 0, failed: 1 });
  if (delivery === "duplicate") return json({ success: true, sent: 0, failed: 0, duplicate: true });
  return json({ success: true, sent: 1, failed: 0 });
}

async function sendLoggedInterventionEmail(
  supabase: ReturnType<typeof createClient>,
  callerId: string,
  interventionId: string | null,
) {
  if (!interventionId) throw new Error("intervention_id is required");

  const { data: roleCheck } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", callerId)
    .eq("role", "instructor")
    .maybeSingle();

  const { data: intervention, error: interventionError } = await supabase
    .from("interventions")
    .select("id, student_id, subject_id")
    .eq("id", interventionId)
    .maybeSingle();
  if (interventionError) throw interventionError;

  let subjectInstructorId: string | null = null;
  let subjectCode: string | null = null;
  if (intervention?.subject_id) {
    const { data: subject } = await supabase
      .from("subjects")
      .select("code, instructor_id")
      .eq("id", intervention.subject_id)
      .maybeSingle();
    subjectInstructorId = subject?.instructor_id ?? null;
    subjectCode = subject?.code ?? null;
  }

  const studentId = loggedInterventionRecipient({
    callerIsInstructor: Boolean(roleCheck),
    callerId,
    intervention: intervention
      ? { studentId: intervention.student_id, subjectInstructorId }
      : null,
  });
  if (!studentId) throw new Error("Not allowed");

  const { data: studentProfile } = await supabase
    .from("profiles")
    .select("email")
    .eq("user_id", studentId)
    .maybeSingle();
  const studentEmail = normalizeEmail(studentProfile?.email);
  if (!studentEmail) return json({ success: true, sent: 0, failed: 0, skipped: "no_email" });

  const logKey = emailLogKey("logged_intervention", interventionId);
  const { data: existing } = await supabase
    .from("email_notifications")
    .select("id")
    .eq("student_id", studentId)
    .eq("risk_level", logKey)
    .limit(1);
  const email = interventionStudentEmail(subjectCode);
  const delivery = await deliverEmail({
    alreadyLogged: (existing ?? []).length > 0,
    send: () => sendBrevoEmail({ to: studentEmail, subject: email.subject, html: email.html }),
    log: async () => {
      const { error: logError } = await supabase.from("email_notifications").insert({
        student_id: studentId,
        subject_id: intervention?.subject_id ?? null,
        risk_level: logKey,
        channel: "email",
      });
      if (logError) throw logError;
    },
  });

  if (delivery === "failed") return json({ success: true, sent: 0, failed: 1 });
  if (delivery === "duplicate") return json({ success: true, sent: 0, failed: 0, duplicate: true });
  return json({ success: true, sent: 1, failed: 0 });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");

    const body = await req.json();
    if (body?.event === "grades_posted") {
      return await sendGradesPostedEmail(
        supabase,
        user.id,
        safeString(body?.subject_id),
        body?.items,
      );
    }
    if (body?.event === "risk_feedback") {
      return await sendRiskFeedbackEmail(supabase, user.id, safeString(body?.feedback_id));
    }
    if (body?.event === "instructor_feedback") {
      return await sendInstructorFeedbackEmail(supabase, user.id, safeString(body?.feedback_id));
    }
    if (body?.event === "engagement_intervention") {
      return await sendEngagementInterventionEmail(supabase, user.id, safeString(body?.intervention_id));
    }
    if (body?.event === "logged_intervention") {
      return await sendLoggedInterventionEmail(supabase, user.id, safeString(body?.intervention_id));
    }

    const { data: roleCheck } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "instructor")
      .single();
    if (!roleCheck) throw new Error("Only instructors can send notifications");
    const subjectCode = safeString(body?.subject_code);
    const subjectName = safeString(body?.subject_name);
    const message = safeString(body?.body);

    if (!subjectCode && !subjectName) throw new Error("subject_code or subject_name is required");

    const emailSubject = `EDGE: ${subjectCode || subjectName} — Important update`;
    const html = message
      ? `<p>${message.replace(/\n/g, "<br>")}</p>`
      : `<p>Your instructor has an update regarding <strong>${subjectCode || subjectName}</strong>.</p><p>Please check the EDGE platform for details.</p>`;

    // Bulk mode: { recipients: [{ to, student_id, subject_id, risk_level }] }
    if (Array.isArray(body?.recipients) && body.recipients.length > 0) {
      const recipientsRaw = body.recipients as Array<Record<string, unknown>>;
      const recipients = recipientsRaw
        .map((r) => ({
          to: normalizeEmail(r?.to),
          studentId: safeString(r?.student_id),
          subjectId: safeString(r?.subject_id),
          riskLevel: safeRiskLevel(r?.risk_level),
        }))
        .filter((r) => !!r.to) as Array<{ to: string; studentId: string | null; subjectId: string | null; riskLevel: RiskLevel | null }>;

      if (recipients.length === 0) throw new Error("recipients must include at least one valid to email");

      const batch = await sendBrevoBatch(recipients.map((r) => ({ to: r.to, subject: emailSubject, html })));

      const sentCount = batch.data?.length ?? 0;
      const failedCount = batch.errors?.length ?? 0;

      // Record notifications for successfully created emails where we have IDs
      // In permissive mode, the response order aligns with input indices; errors are reported by index.
      const failedIdx = new Set((batch.errors ?? []).map((e) => e.index));
      const successRecipients = recipients.filter((_, idx) => !failedIdx.has(idx));

      const toInsert = successRecipients
        .filter((r) => r.studentId && r.subjectId && (r.riskLevel === "critical" || r.riskLevel === "at_risk"))
        .map((r) => ({
          student_id: r.studentId!,
          subject_id: r.subjectId!,
          risk_level: r.riskLevel!,
          channel: "email",
        }));
      if (toInsert.length > 0) await supabase.from("email_notifications").insert(toInsert);

      return new Response(
        JSON.stringify({
          success: true,
          mode: "bulk",
          sent: sentCount,
          failed: failedCount,
          errors: batch.errors ?? [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Single mode: { to, student_id, subject_id, risk_level }
    const to = normalizeEmail(body?.to);
    const riskLevel = safeRiskLevel(body?.risk_level);
    const studentId = safeString(body?.student_id);
    const subjectId = safeString(body?.subject_id);

    if (!to) throw new Error("to (student email) is required");

    const result = await sendBrevoEmail({ to, subject: emailSubject, html });

    if (studentId && subjectId && (riskLevel === "critical" || riskLevel === "at_risk")) {
      await supabase.from("email_notifications").insert({
        student_id: studentId,
        subject_id: subjectId,
        risk_level: riskLevel,
        channel: "email",
      });
    }

    return new Response(JSON.stringify({ success: true, mode: "single", id: result.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-notification error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

