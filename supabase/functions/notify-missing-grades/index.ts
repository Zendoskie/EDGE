import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendBrevoEmailBatch } from "../_shared/brevo-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function safeString(s: unknown): string | null {
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

function normalizeEmail(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  return trimmed;
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

    const { data: roleCheck } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "instructor")
      .single();
    if (!roleCheck) throw new Error("Only instructors can publish grades");

    const body = await req.json().catch(() => ({}));
    const activityId = safeString(body?.activity_id);
    if (!activityId) throw new Error("activity_id is required");

    const { data: activity, error: actError } = await supabase
      .from("activities")
      .select("id, title, subject_id, grades_published_at, subjects(id, code, name, instructor_id)")
      .eq("id", activityId)
      .maybeSingle();
    if (actError) throw actError;
    if (!activity) throw new Error("Activity not found");

    const subject = (activity as unknown as { subjects?: { instructor_id?: string; code?: string; name?: string } | null }).subjects;
    const instructorId = subject?.instructor_id;
    if (!instructorId || instructorId !== user.id) throw new Error("You do not have access to this activity");

    const subjectId = (activity as unknown as { subject_id?: string | null }).subject_id;
    if (!subjectId) throw new Error("Activity missing subject_id");

    const { data: enrollments, error: enrError } = await supabase
      .from("enrollments")
      .select("student_id")
      .eq("subject_id", subjectId)
      .eq("status", "active");
    if (enrError) throw enrError;

    const enrolledStudentIds = (enrollments ?? []).map((e) => (e as { student_id?: string | null }).student_id).filter(Boolean) as string[];
    if (enrolledStudentIds.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0, skippedNoEmail: 0, missingCount: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: subs, error: subsError } = await supabase
      .from("submissions")
      .select("student_id, score")
      .eq("activity_id", activityId)
      .in("student_id", enrolledStudentIds);
    if (subsError) throw subsError;

    const scoreByStudentId = new Map<string, number | null>();
    for (const s of subs ?? []) {
      const row = s as { student_id?: string | null; score?: number | null };
      if (!row.student_id) continue;
      scoreByStudentId.set(row.student_id, row.score ?? null);
    }

    const missingStudentIds = enrolledStudentIds.filter((sid) => {
      if (!scoreByStudentId.has(sid)) return true;
      return scoreByStudentId.get(sid) == null;
    });

    if (missingStudentIds.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0, skippedNoEmail: 0, missingCount: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profiles, error: profError } = await supabase
      .from("profiles")
      .select("user_id, email, full_name")
      .in("user_id", missingStudentIds);
    if (profError) throw profError;

    const recipients = (profiles ?? [])
      .map((p) => ({
        userId: (p as { user_id?: string | null }).user_id ?? null,
        email: normalizeEmail((p as { email?: string | null }).email),
        fullName: safeString((p as { full_name?: string | null }).full_name),
      }))
      .filter((p) => !!p.userId) as Array<{ userId: string; email: string | null; fullName: string | null }>;

    const activityTitle = safeString((activity as unknown as { title?: string }).title) || "an activity";
    const subjectCode = subject?.code?.trim() || "your subject";
    const subjectName = subject?.name?.trim() || "";
    const notificationBody = `You have a missing grade for ${activityTitle} in ${subjectCode}.`;

    const { data: instructorProfile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("user_id", user.id)
      .maybeSingle();
    const sourceName = safeString((instructorProfile as { full_name?: string | null } | null)?.full_name) || "the instructor";

    await supabase
      .from("activities")
      .update({
        grades_published_at: (activity as { grades_published_at?: string | null }).grades_published_at ?? new Date().toISOString(),
        grades_published_by: user.id,
      })
      .eq("id", activityId)
      .is("grades_published_at", null);

    const { data: existingNotes } = recipients.length === 0
      ? { data: [] as Array<{ user_id?: string }> }
      : await supabase
      .from("user_inbox_notifications")
      .select("user_id")
      .eq("title", "Missing grade")
      .eq("body", notificationBody)
      .in("user_id", recipients.map((r) => r.userId));
    const alreadyNotified = new Set(
      (existingNotes ?? []).map((row) => (row as { user_id?: string }).user_id).filter(Boolean) as string[],
    );
    const newlyMissing = recipients.filter((r) => !alreadyNotified.has(r.userId));

    if (newlyMissing.length > 0) {
      const { error: insertError } = await supabase.from("user_inbox_notifications").insert(
        newlyMissing.map((r) => ({
          user_id: r.userId,
          title: "Missing grade",
          body: notificationBody,
          source_name: sourceName,
        })),
      );
      if (insertError) throw insertError;
    }

    const emailSubject = `EDGE: ${subjectCode} — Important update`;
    const withEmail = newlyMissing.filter((r) => !!r.email) as Array<{ userId: string; email: string; fullName: string | null }>;
    const skippedNoEmail = newlyMissing.length - withEmail.length;

    if (withEmail.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        sent: 0,
        skippedNoEmail,
        missingCount: recipients.length,
        created: newlyMissing.length,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const htmlFor = (name: string | null) => {
      const greeting = name ? `Hi ${name},` : "Hi,";
      const subjectLine = subjectName ? `${subjectCode} — ${subjectName}` : subjectCode;
      return [
        `<p>${greeting}</p>`,
        `<p>${notificationBody}</p>`,
        `<p>This is for <strong>${activityTitle}</strong> in <strong>${subjectLine}</strong>. Your instructor has published grades, and EDGE does not have a recorded score for you yet.</p>`,
        `<p>— EDGE</p>`,
      ].join("");
    };

    const batch = await sendBrevoEmailBatch(
      withEmail.map((r) => ({
        to: r.email,
        subject: emailSubject,
        html: htmlFor(r.fullName),
      })),
    );

    return new Response(
      JSON.stringify({
        success: true,
        sent: batch.sent,
        failed: batch.failed,
        errors: batch.errors,
        skippedNoEmail,
        missingCount: recipients.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("notify-missing-grades error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

