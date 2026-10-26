import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  deliverEmail,
  emailLogKey,
  parentRegistrationSubmittedLogId,
} from "../_shared/notification-channels.ts";
import { sendBrevoEmail } from "../_shared/brevo-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const appUrl = (Deno.env.get("APP_URL") || "https://edge.example.com").replace(/\/+$/, "");

function jsonError(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonOk(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function notifyStudentForRegistrationRequest(
  db: ReturnType<typeof createClient>,
  registrationRequestId: string,
) {
  const { data: request, error: requestErr } = await db
    .from("parent_registration_requests")
    .select("id, student_user_id, email, full_name, student_name, status, submitted_at")
    .eq("id", registrationRequestId)
    .maybeSingle();

  if (requestErr) {
    console.error("notify-student-on-parent-registration: request lookup error", requestErr);
    return jsonError("Could not verify parent registration request", 500);
  }
  if (!request) return jsonError("Parent registration request not found", 404);
  if (request.status !== "pending") {
    return jsonOk({ success: true, skipped: true, reason: "not_pending" });
  }

  const { data: studentProf, error: studentProfErr } = await db
    .from("profiles")
    .select("email, full_name")
    .eq("user_id", request.student_user_id)
    .maybeSingle();

  if (studentProfErr || !studentProf?.email) {
    console.error("notify-student-on-parent-registration: student profile lookup error", studentProfErr);
    return jsonError("Could not retrieve student profile", 500);
  }

  const parentName = request.full_name?.trim() || "A parent/guardian";
  const parentEmail = request.email?.trim() || "no email";
  const studentName = studentProf.full_name?.trim() || request.student_name?.trim() || "Student";

  const subject = "EDGE: A parent/guardian is requesting access to your academic records";
  const html = `<p>Hi ${studentName},</p>
<p><strong>${parentName}</strong> (${parentEmail}) is requesting parent/guardian access to your academic records on the <strong>EDGE Student Risk Analysis and AI Coaching System</strong>.</p>
<p><strong>To approve or reject this request:</strong></p>
<ol>
  <li>Log in to the EDGE platform: <a href="${appUrl}">${appUrl}</a></li>
  <li>Go to <strong>Parent Access Requests</strong> in your dashboard.</li>
  <li>Review and approve or reject the request.</li>
</ol>
<p>Check that you recognize this person's name and email before approving. After you approve, an administrator must also approve before they can view any of your academic information.</p>
<p>– The EDGE Team</p>`;

  const logKey = emailLogKey(
    "parent_registration_submitted",
    parentRegistrationSubmittedLogId(request.id),
  );
  const { data: existing } = await db
    .from("email_notifications")
    .select("id")
    .eq("student_id", request.student_user_id)
    .eq("risk_level", logKey)
    .limit(1);

  const delivery = await deliverEmail({
    alreadyLogged: (existing ?? []).length > 0,
    send: () => sendBrevoEmail({ to: studentProf.email, subject, html }),
    log: async () => {
      const { error: logError } = await db.from("email_notifications").insert({
        student_id: request.student_user_id,
        subject_id: null,
        risk_level: logKey,
        channel: "email",
      });
      if (logError) throw logError;
    },
  });

  if (delivery === "failed") {
    return jsonOk({ success: true, sent: 0, failed: 1 });
  }
  if (delivery === "duplicate") {
    return jsonOk({ success: true, sent: 0, failed: 0, duplicate: true });
  }
  return jsonOk({ success: true, sent: 1, failed: 0 });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const registrationRequestId =
      typeof body.registration_request_id === "string" ? body.registration_request_id.trim() : "";

    if (registrationRequestId) {
      return await notifyStudentForRegistrationRequest(db, registrationRequestId);
    }

    const parentEmail = typeof body.parent_email === "string" ? body.parent_email.trim() : "";

    if (!parentEmail) {
      return jsonError("parent_email or registration_request_id is required");
    }

    const { data: parentProf, error: parentProfErr } = await db
      .from("profiles")
      .select("user_id, full_name, email")
      .eq("email", parentEmail)
      .maybeSingle();

    if (parentProfErr) {
      console.error("notify-student-on-parent-registration: parent profile lookup error", parentProfErr);
      return jsonError("Could not verify parent profile", 500);
    }

    if (!parentProf) {
      return jsonError("Parent profile not found", 404);
    }

    const { data: link, error: linkErr } = await db
      .from("parent_student_links")
      .select("id, student_user_id")
      .eq("parent_user_id", parentProf.user_id)
      .eq("status", "pending")
      .gte("requested_at", new Date(Date.now() - 15 * 60 * 1000).toISOString())
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (linkErr) {
      console.error("notify-student-on-parent-registration: link lookup error", linkErr);
      return jsonError("Could not retrieve parent link", 500);
    }

    if (!link) {
      return jsonOk({ success: true, skipped: true });
    }

    const { data: studentProf, error: studentProfErr } = await db
      .from("profiles")
      .select("email, full_name")
      .eq("user_id", link.student_user_id)
      .maybeSingle();

    if (studentProfErr || !studentProf?.email) {
      console.error("notify-student-on-parent-registration: student profile lookup error", studentProfErr);
      return jsonError("Could not retrieve student profile", 500);
    }

    const parentName = parentProf.full_name?.trim() || "A parent/guardian";
    const parentEmailDisplay = parentProf.email?.trim() || parentEmail;
    const studentName = studentProf.full_name?.trim() || "Student";

    const subject = "EDGE: A parent/guardian is requesting access to your academic records";
    const html = `<p>Hi ${studentName},</p>
<p><strong>${parentName}</strong> (${parentEmailDisplay}) has created a parent/guardian account on the <strong>EDGE Student Risk Analysis and AI Coaching System</strong> using your Student ID and is requesting access to your academic records.</p>
<p><strong>To approve or reject this request:</strong></p>
<ol>
  <li>Log in to the EDGE platform: <a href="${appUrl}">${appUrl}</a></li>
  <li>Go to <strong>Parent Access Requests</strong> in your dashboard.</li>
  <li>Review and approve or reject the request.</li>
</ol>
<p>Check that you recognize this person's name and email before approving. After you approve, an administrator must also approve before they can view any of your academic information.</p>
<p>– The EDGE Team</p>`;

    await sendBrevoEmail({ to: studentProf.email, subject, html });

    return jsonOk({ success: true });
  } catch (e) {
    console.error("notify-student-on-parent-registration error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
