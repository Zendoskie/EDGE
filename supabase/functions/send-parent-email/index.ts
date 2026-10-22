import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  deliverEmail,
  emailLogKey,
  parentRegistrationDecisionLogId,
} from "../_shared/notification-channels.ts";
import {
  normalizeEmailForCompare,
  registrationWelcomeDecisionId,
  validateRegistrationWelcomeEligibility,
} from "../_shared/parent-registration-welcome.ts";
import {
  deliverRegistrationWelcomeEmail,
  type RegistrationWelcomeClaimOutcome,
} from "../_shared/registration-welcome-email-delivery.ts";
import { sendBrevoEmail } from "../_shared/brevo-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type DecisionEmailType = "student_approved" | "student_rejected" | "admin_approved" | "admin_rejected";
type ParentEmailType = "invitation" | "request_received" | DecisionEmailType;

const ACCEPTED_TYPES = [
  "invitation",
  "request_received",
  "student_approved",
  "student_rejected",
  "admin_approved",
  "admin_rejected",
  "registration_access_activated",
  // Legacy aliases for the student decision.
  "approved",
  "rejected",
];

function canonicalType(raw: string): ParentEmailType {
  if (raw === "approved") return "student_approved";
  if (raw === "rejected") return "student_rejected";
  return raw as ParentEmailType;
}

/** The link must already be in the state the email describes. */
const REQUIRED_LINK_STATUS: Record<DecisionEmailType, string> = {
  student_approved: "pending_admin",
  student_rejected: "rejected",
  admin_approved: "approved",
  admin_rejected: "admin_rejected",
};

function safeString(s: unknown): string | null {
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

function normalizeEmail(s: unknown): string | null {
  const t = safeString(s);
  if (!t) return null;
  return t;
}

const appUrl = (Deno.env.get("APP_URL") || "https://edge.example.com").replace(/\/+$/, "");

function buildEmail(
  type: ParentEmailType,
  opts: { parentName?: string | null; studentName?: string | null; studentIdNo?: string | null },
): { subject: string; html: string } {
  const parentName = opts.parentName?.trim() || "Parent/Guardian";
  const studentName = opts.studentName?.trim() || "student";
  const studentIdNo = opts.studentIdNo?.trim();

  switch (type) {
    case "invitation": {
      const nameDisplay = studentName?.trim() || "Your child";
      const idLine = studentIdNo ? `<p><strong>Student ID/No.:</strong> ${studentIdNo}</p>` : "";
      const idInstruction = studentIdNo
        ? ` Enter your child's Student ID/No. when prompted: <strong>${studentIdNo}</strong>.`
        : "";
      return {
        subject: "EDGE: Create your parent/guardian account",
        html: `<p>Hello,</p>
<p><strong>${nameDisplay}</strong> has registered on the <strong>EDGE Student Risk Analysis and AI Coaching System</strong> and listed you as their parent/guardian.</p>
${idLine}
<p>To view your child's academic information, please create a Parent account on the EDGE platform.</p>
<p><strong>How to create a Parent account:</strong></p>
<ol>
  <li>Go to: <a href="${appUrl}">${appUrl}</a></li>
  <li>Click <strong>Sign Up</strong> and select <strong>Parent / Guardian</strong> as your role.</li>
  <li>Register using this email address.${idInstruction}</li>
  <li>Once registered, ${nameDisplay} will be asked to approve your access request before you can view their academic information.</li>
</ol>
<p>– The EDGE Team</p>`,
      };
    }
    case "request_received":
      return {
        subject: "EDGE: Parent/guardian access request",
        html: `<p>Hi ${studentName},</p>
<p>Your registered parent/guardian <strong>${parentName}</strong> is requesting access to your academic records on the <strong>EDGE Student Risk Analysis and AI Coaching System</strong>.</p>
<p><strong>To approve or reject this request:</strong></p>
<ol>
  <li>Log in to EDGE: <a href="${appUrl}">${appUrl}</a></li>
  <li>Go to <strong>Parent Access Requests</strong> in the sidebar.</li>
  <li>Review and approve or reject the request.</li>
</ol>
<p>No academic information will be shared unless you approve and an administrator also approves.</p>
<p>– The EDGE Team</p>`,
      };
    case "student_approved":
      return {
        subject: "EDGE: Student approved your request",
        html: `<p>Hi ${parentName},</p>
<p><strong>${studentName}</strong> has <strong>approved</strong> your parent/guardian request.</p>
<p>Your request is now waiting for <strong>administrator approval</strong>. You will be able to sign in and view academic information once an administrator approves it. We will email you when that happens.</p>
<p>– The EDGE Team</p>`,
      };
    case "student_rejected":
      return {
        subject: "EDGE: Access request rejected",
        html: `<p>Hi ${parentName},</p>
<p>Your request to access <strong>${studentName}</strong>'s academic records was <strong>rejected</strong> by the student.</p>
<p>Your parent/guardian access is not active. If you believe this was a mistake, please contact the student or the school administrator.</p>
<p>– The EDGE Team</p>`,
      };
    case "admin_rejected":
      return {
        subject: "EDGE: Access request not approved",
        html: `<p>Hi ${parentName},</p>
<p>An administrator did <strong>not approve</strong> your request to access <strong>${studentName}</strong>'s academic records.</p>
<p>Your parent/guardian access is not active. If you believe this was a mistake, please contact the school administrator.</p>
<p>– The EDGE Team</p>`,
      };
    case "admin_approved":
      return {
        subject: "EDGE: Parent/guardian access approved",
        html: `<p>Hi ${parentName},</p>
<p>Your request to access <strong>${studentName}</strong>'s academic records has been approved by the student and by an administrator. Your parent account is now <strong>active</strong>.</p>
<p>You can now view the following from the <strong>Student Performance</strong> page:</p>
<ul>
  <li>Student Profile</li>
  <li>Grades and Activity Scores</li>
  <li>Attendance Records</li>
  <li>Risk Analysis</li>
  <li>AI Coaching Recommendations</li>
</ul>
<p>Log in and go to <strong>Student Performance</strong> to view academic information: <a href="${appUrl}">${appUrl}</a></p>
<p>– The EDGE Team</p>`,
      };
  }
}

async function handleRegistrationAccessActivated(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const completionToken = safeString(body?.completion_token);
  if (!completionToken) throw new Error("completion_token is required");

  const { data: invitation, error: invError } = await supabase
    .from("staff_invitations")
    .select("id, email, status, role, parent_request_id, accepted_at")
    .eq("token", completionToken)
    .maybeSingle();
  if (invError) throw new Error("Could not verify invitation");
  if (!invitation?.parent_request_id) throw new Error("Invalid or incomplete registration");

  const { data: request, error: reqError } = await supabase
    .from("parent_registration_requests")
    .select("id, email, full_name, student_name, student_user_id, status, completed_at")
    .eq("id", invitation.parent_request_id)
    .maybeSingle();
  if (reqError) throw new Error("Could not verify parent registration request");
  if (!request) throw new Error("Invalid or incomplete registration");

  const { data: approvedLinks, error: linkError } = await supabase
    .from("parent_student_links")
    .select("parent_user_id, status")
    .eq("student_user_id", request.student_user_id)
    .eq("status", "approved");
  if (linkError) throw new Error("Could not verify parent link");

  const invitationEmailNorm = normalizeEmailForCompare(invitation.email);
  let linkStatus: string | null = null;
  let parentProfileEmail: string | null = null;

  for (const link of approvedLinks ?? []) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("email")
      .eq("user_id", link.parent_user_id)
      .maybeSingle();
    if (profileError) throw new Error("Could not verify parent profile");
    const profileNorm = normalizeEmailForCompare(profile?.email);
    if (
      profileNorm
      && profileNorm === invitationEmailNorm
      && profileNorm === normalizeEmailForCompare(request.email)
    ) {
      linkStatus = link.status;
      parentProfileEmail = profile?.email ?? null;
      break;
    }
  }

  const eligibility = validateRegistrationWelcomeEligibility({
    invitationRole: String((invitation as { role?: string }).role ?? ""),
    invitationStatus: String((invitation as { status?: string }).status ?? ""),
    invitationEmail: invitation.email ?? "",
    requestStatus: String((request as { status?: string }).status ?? ""),
    requestCompletedAt: request.completed_at,
    requestEmail: request.email ?? "",
    linkStatus,
    parentProfileEmail,
  });
  if (!eligibility.eligible) {
    throw new Error("Invalid or incomplete registration");
  }

  const parentEmail = normalizeEmail(request.email);
  if (!parentEmail) throw new Error("Parent email not on file");

  const completedAt = String(request.completed_at);
  const logKey = emailLogKey(
    "parent_registration_decision",
    parentRegistrationDecisionLogId(
      request.id,
      registrationWelcomeDecisionId(request.id, completedAt),
    ),
  );

  const emailContent = buildEmail("admin_approved", {
    parentName: request.full_name,
    studentName: request.student_name,
  });

  const delivery = await deliverRegistrationWelcomeEmail({
    claim: async (): Promise<RegistrationWelcomeClaimOutcome> => {
      const { data, error } = await supabase.rpc("try_claim_registration_welcome_email", {
        p_request_id: request.id,
        p_dedupe_key: logKey,
        p_student_id: request.student_user_id,
      });
      if (error) throw new Error("Could not reserve welcome email delivery");
      const outcome = String(data ?? "");
      if (outcome === "claimed" || outcome === "duplicate" || outcome === "in_flight") {
        return outcome;
      }
      return "in_flight";
    },
    send: () => sendBrevoEmail({ to: parentEmail, subject: emailContent.subject, html: emailContent.html }),
    markSent: async () => {
      const { data: marked, error } = await supabase.rpc("complete_registration_welcome_email", {
        p_request_id: request.id,
        p_dedupe_key: logKey,
      });
      if (error || !marked) throw new Error("Could not confirm welcome email delivery");
    },
    markFailed: async () => {
      await supabase.rpc("fail_registration_welcome_email", {
        p_request_id: request.id,
        p_dedupe_key: logKey,
      });
    },
    afterSent: async () => {
      const { error: logError } = await supabase.from("email_notifications").insert({
        student_id: request.student_user_id,
        risk_level: logKey,
        channel: "email",
      });
      if (logError) throw logError;
    },
  });

  if (delivery === "failed") {
    return new Response(JSON.stringify({ success: true, sent: 0, failed: 1, type: "registration_access_activated" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (delivery === "duplicate") {
    return new Response(JSON.stringify({ success: true, sent: 0, failed: 0, duplicate: true, type: "registration_access_activated" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ success: true, sent: 1, failed: 0, type: "registration_access_activated" }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const rawType = safeString(body?.type);
    if (!rawType || !ACCEPTED_TYPES.includes(rawType)) {
      throw new Error(`type must be one of ${ACCEPTED_TYPES.join(", ")}`);
    }

    if (rawType === "registration_access_activated") {
      return await handleRegistrationAccessActivated(supabase, body as Record<string, unknown>);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");

    const type = canonicalType(rawType);

    const to = normalizeEmail(body?.to);
    const linkId = safeString(body?.link_id);
    const studentIdNo = safeString(body?.student_id_no);

    const parentName: string | null = safeString(body?.parent_name);
    const studentName: string | null = safeString(body?.student_name);

    // Ownership verification: only the involved parties may trigger an email.
    if (type === "invitation") {
      // Caller must be the student whose stored parent email matches the recipient.
      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("parent_email, student_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (profErr) throw new Error("Could not verify student profile");
      if (!prof?.parent_email || !prof.parent_email.trim()) throw new Error("No parent email on file");
      if (prof.parent_email.trim().toLowerCase() !== to.toLowerCase()) {
        throw new Error("Parent email does not match the student's registered parent email");
      }
      const inviteStudentIdNo = studentIdNo || prof.student_id || null;
      return sendBrevoEmail({
        to,
        ...buildEmail("invitation", { studentName, studentIdNo: inviteStudentIdNo }),
      })
        .then(() => new Response(JSON.stringify({ success: true, type }), { headers: { ...corsHeaders, "Content-Type": "application/json" } }));
    }

    const registrationRequestId = safeString(body?.registration_request_id);
    if (registrationRequestId) {
      const decisionType = type as DecisionEmailType;
      const { data: request, error: requestErr } = await supabase
        .from("parent_registration_requests")
        .select("id, student_user_id, email, full_name, student_name, status, student_decided_at, reviewed_at")
        .eq("id", registrationRequestId)
        .maybeSingle();
      if (requestErr) throw new Error("Could not verify parent registration request");
      if (!request) throw new Error("Parent registration request not found");

      if (decisionType === "admin_rejected") {
        const { data: adminRole } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin")
          .maybeSingle();
        if (!adminRole) throw new Error("Forbidden");
        if (request.status !== "admin_rejected") {
          throw new Error("Request status does not match this notification");
        }
        if (!request.reviewed_at) {
          throw new Error("Request review timestamp is missing");
        }
        const parentEmail = normalizeEmail(request.email);
        if (!parentEmail) throw new Error("Parent email not on file");
        const emailContent = buildEmail("admin_rejected", {
          parentName: request.full_name,
          studentName: request.student_name,
        });
        const logKey = emailLogKey(
          "parent_registration_decision",
          parentRegistrationDecisionLogId(
            request.id,
            `admin_rejected:${request.reviewed_at}`,
          ),
        );
        const { data: existing } = await supabase
          .from("email_notifications")
          .select("id")
          .eq("student_id", request.student_user_id)
          .eq("risk_level", logKey)
          .limit(1);
        const delivery = await deliverEmail({
          alreadyLogged: (existing ?? []).length > 0,
          send: () => sendBrevoEmail({ to: parentEmail, subject: emailContent.subject, html: emailContent.html }),
          log: async () => {
            const { error: logError } = await supabase.from("email_notifications").insert({
              student_id: request.student_user_id,
              risk_level: logKey,
              channel: "email",
            });
            if (logError) throw logError;
          },
        });
        if (delivery === "failed") {
          return new Response(JSON.stringify({ success: true, sent: 0, failed: 1, type }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (delivery === "duplicate") {
          return new Response(JSON.stringify({ success: true, sent: 0, failed: 0, duplicate: true, type }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ success: true, sent: 1, failed: 0, type }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (decisionType !== "student_approved" && decisionType !== "student_rejected") {
        throw new Error("registration_request_id is only valid for student or admin rejection emails");
      }
      if (request.student_user_id !== user.id) throw new Error("Forbidden");
      const expectedStatus = decisionType === "student_approved" ? "pending_admin" : "rejected";
      if (request.status !== expectedStatus) {
        throw new Error("Request status does not match this notification");
      }
      if (!request.student_decided_at) {
        throw new Error("Request decision timestamp is missing");
      }
      const parentEmail = normalizeEmail(request.email);
      if (!parentEmail) throw new Error("Parent email not on file");
      const emailContent = buildEmail(decisionType, {
        parentName: request.full_name,
        studentName: request.student_name,
      });
      const logKey = emailLogKey(
        "parent_registration_decision",
        parentRegistrationDecisionLogId(
          request.id,
          `${decisionType}:${request.student_decided_at}`,
        ),
      );
      const { data: existing } = await supabase
        .from("email_notifications")
        .select("id")
        .eq("student_id", request.student_user_id)
        .eq("risk_level", logKey)
        .limit(1);
      const delivery = await deliverEmail({
        alreadyLogged: (existing ?? []).length > 0,
        send: () => sendBrevoEmail({ to: parentEmail, subject: emailContent.subject, html: emailContent.html }),
        log: async () => {
          const { error: logError } = await supabase.from("email_notifications").insert({
            student_id: request.student_user_id,
            risk_level: logKey,
            channel: "email",
          });
          if (logError) throw logError;
        },
      });
      if (delivery === "failed") {
        return new Response(JSON.stringify({ success: true, sent: 0, failed: 1, type }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (delivery === "duplicate") {
        return new Response(JSON.stringify({ success: true, sent: 0, failed: 0, duplicate: true, type }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true, sent: 1, failed: 0, type }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!linkId) throw new Error("link_id is required");

    const { data: link, error: linkErr } = await supabase
      .from("parent_student_links")
      .select("id, parent_user_id, student_user_id, student_id_no, status")
      .eq("id", linkId)
      .maybeSingle();
    if (linkErr) throw new Error("Could not verify parent link");

    if (!link) throw new Error("Parent link not found");

    if (type === "request_received") {
      // Caller must be the parent on the link; recipient is the student (resolved server-side).
      if (link.parent_user_id !== user.id) throw new Error("Forbidden");
      const { data: sProf } = await supabase
        .from("profiles")
        .select("email, full_name")
        .eq("user_id", link.student_user_id)
        .maybeSingle();
      if (!sProf?.email) throw new Error("Linked student has no email on file");
      const { data: pProf } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", link.parent_user_id)
        .maybeSingle();
      return sendBrevoEmail({
        to: sProf.email,
        ...buildEmail("request_received", {
          parentName: parentName || pProf?.full_name || null,
          studentName: sProf?.full_name || studentName,
        }),
      })
        .then(() => new Response(JSON.stringify({ success: true, type }), { headers: { ...corsHeaders, "Content-Type": "application/json" } }));
    }

    // Decision emails go to the parent (resolved server-side). Student decisions must be sent by
    // the link's student; admin decisions by an administrator.
    const decisionType = type as DecisionEmailType;
    if (decisionType === "admin_approved" || decisionType === "admin_rejected") {
      const { data: adminRole } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (!adminRole) throw new Error("Forbidden");
    } else if (link.student_user_id !== user.id) {
      throw new Error("Forbidden");
    }
    if (link.status !== REQUIRED_LINK_STATUS[decisionType]) {
      throw new Error("Link status does not match this notification");
    }
    const { data: pProf2 } = await supabase
      .from("profiles")
      .select("email, full_name")
      .eq("user_id", link.parent_user_id)
      .maybeSingle();
    if (!pProf2?.email) throw new Error("Linked parent has no email on file");
    const { data: sProf2 } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("user_id", link.student_user_id)
      .maybeSingle();

    return sendBrevoEmail({
      to: pProf2.email,
      ...buildEmail(decisionType, {
        parentName: pProf2.full_name || parentName,
        studentName: sProf2?.full_name || studentName,
      }),
    })
      .then(() => new Response(JSON.stringify({ success: true, type }), { headers: { ...corsHeaders, "Content-Type": "application/json" } }));
  } catch (e) {
    console.error("send-parent-email error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
