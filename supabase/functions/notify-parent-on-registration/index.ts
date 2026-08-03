import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  const result = await res.json().catch(() => ({})) as { message?: string; error?: string };
  if (!res.ok) {
    const msg = result.message || result.error || `Brevo error (${res.status})`;
    throw new Error(msg);
  }
}

function buildInvitationEmail(
  studentName: string | null,
  studentIdNo: string | null,
): { subject: string; html: string } {
  const nameDisplay = studentName?.trim() || "Your child";
  const idLine = studentIdNo
    ? `<p><strong>Student ID/No.:</strong> ${studentIdNo}</p>`
    : "";
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const studentEmail = typeof body.student_email === "string" ? body.student_email.trim() : "";
    const parentEmail = typeof body.parent_email === "string" ? body.parent_email.trim() : "";
    const studentName = typeof body.student_name === "string" ? body.student_name.trim() || null : null;
    const studentIdNo = typeof body.student_id_no === "string" ? body.student_id_no.trim() || null : null;

    if (!studentEmail || !parentEmail) {
      return jsonError("student_email and parent_email are required");
    }

    // Look up the student profile using the service role.
    const { data: prof, error: profErr } = await db
      .from("profiles")
      .select("user_id, full_name, student_id, parent_email")
      .eq("email", studentEmail)
      .maybeSingle();

    if (profErr) {
      console.error("notify-parent-on-registration: profile lookup error", profErr);
      return jsonError("Could not verify student profile", 500);
    }

    if (!prof) {
      // Profile may not exist yet if the trigger hasn't completed — surface a retryable error.
      return jsonError("Student profile not found", 404);
    }

    // Security: the provided parent_email must match what is stored on the student profile.
    // This prevents unauthenticated callers from sending arbitrary emails.
    if (
      !prof.parent_email ||
      prof.parent_email.trim().toLowerCase() !== parentEmail.toLowerCase()
    ) {
      return jsonError("Parent email does not match the student's registered parent email");
    }

    const resolvedStudentName = studentName || prof.full_name || null;
    const resolvedStudentIdNo = studentIdNo || prof.student_id || null;

    const { subject, html } = buildInvitationEmail(resolvedStudentName, resolvedStudentIdNo);
    await sendBrevoEmail({ to: parentEmail, subject, html });

    // Record that the invitation was sent.
    const { error: logErr } = await db.from("parent_invitation_log").insert({
      student_user_id: prof.user_id,
      parent_email: parentEmail,
      student_name: resolvedStudentName,
      student_id_no: resolvedStudentIdNo,
      triggered_by: "registration",
    });

    if (logErr) {
      // Non-fatal: email was sent; log the failure but still return success.
      console.error("notify-parent-on-registration: invitation log insert error", logErr);
    }

    return jsonOk({ success: true });
  } catch (e) {
    console.error("notify-parent-on-registration error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
