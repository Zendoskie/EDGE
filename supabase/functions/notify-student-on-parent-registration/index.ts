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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const parentEmail = typeof body.parent_email === "string" ? body.parent_email.trim() : "";

    if (!parentEmail) {
      return jsonError("parent_email is required");
    }

    // Look up the parent's profile using the service role.
    const { data: parentProf, error: parentProfErr } = await db
      .from("profiles")
      .select("user_id, full_name")
      .eq("email", parentEmail)
      .maybeSingle();

    if (parentProfErr) {
      console.error("notify-student-on-parent-registration: parent profile lookup error", parentProfErr);
      return jsonError("Could not verify parent profile", 500);
    }

    if (!parentProf) {
      // Profile may not exist yet if the trigger hasn't completed.
      return jsonError("Parent profile not found", 404);
    }

    // Find the most recent pending link this parent has (just created by the DB trigger).
    const { data: link, error: linkErr } = await db
      .from("parent_student_links")
      .select("id, student_user_id")
      .eq("parent_user_id", parentProf.user_id)
      .eq("status", "pending")
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (linkErr) {
      console.error("notify-student-on-parent-registration: link lookup error", linkErr);
      return jsonError("Could not retrieve parent link", 500);
    }

    if (!link) {
      // No pending link found — nothing to notify.
      return jsonOk({ success: true, skipped: true });
    }

    // Look up the student's email.
    const { data: studentProf, error: studentProfErr } = await db
      .from("profiles")
      .select("email, full_name")
      .eq("user_id", link.student_user_id)
      .maybeSingle();

    if (studentProfErr || !studentProf?.email) {
      console.error("notify-student-on-parent-registration: student profile lookup error", studentProfErr);
      return jsonError("Could not retrieve student profile", 500);
    }

    const parentName = parentProf.full_name?.trim() || "Your registered parent";
    const studentName = studentProf.full_name?.trim() || "Student";

    const subject = "EDGE: A parent/guardian is requesting access to your academic records";
    const html = `<p>Hi ${studentName},</p>
<p>Your registered parent/guardian <strong>${parentName}</strong> has created an account on the <strong>EDGE Student Risk Analysis and AI Coaching System</strong> and is requesting access to your academic records.</p>
<p>Your registered parent is requesting access to your academic records.</p>
<p><strong>To approve or reject this request:</strong></p>
<ol>
  <li>Log in to the EDGE platform: <a href="${appUrl}">${appUrl}</a></li>
  <li>Go to <strong>Parent Access Requests</strong> in your dashboard.</li>
  <li>Review and approve or reject the request.</li>
</ol>
<p>Until you approve, your parent cannot view any of your academic information.</p>
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
