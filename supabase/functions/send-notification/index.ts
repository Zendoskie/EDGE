import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

async function sendResendEmail(opts: { to: string; subject: string; html: string }) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) throw new Error("Email not configured. Add RESEND_API_KEY to Edge Function secrets.");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      // Use a verified domain here if you have one, e.g. "EDGE <noreply@yourdomain.com>"
      from: "EDGE <onboarding@resend.dev>",
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    }),
  });

  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (result && (result.message || result.error)) ? (result.message || result.error) : `Resend error (${res.status})`;
    throw new Error(msg);
  }
  return result as { id: string };
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
    if (!roleCheck) throw new Error("Only instructors can send notifications");

    const body = await req.json();
    const to = normalizeEmail(body?.to);
    const subjectCode = typeof body?.subject_code === "string" ? body.subject_code : null;
    const subjectName = typeof body?.subject_name === "string" ? body.subject_name : null;
    const message = typeof body?.body === "string" ? body.body : null;
    const riskLevel = (typeof body?.risk_level === "string" ? body.risk_level : null) as RiskLevel | null;
    const studentId = typeof body?.student_id === "string" ? body.student_id : null;
    const subjectId = typeof body?.subject_id === "string" ? body.subject_id : null;

    if (!to) throw new Error("to (student email) is required");
    if (!subjectCode && !subjectName) throw new Error("subject_code or subject_name is required");

    const emailSubject = `EDGE: ${subjectCode || subjectName} — Important update`;
    const html = message
      ? `<p>${message.replace(/\n/g, "<br>")}</p>`
      : `<p>Your instructor has an update regarding <strong>${subjectCode || subjectName}</strong>.</p><p>Please check the EDGE platform for details.</p>`;

    const result = await sendResendEmail({ to, subject: emailSubject, html });

    // Optional: record sent notification if IDs provided
    if (studentId && subjectId && riskLevel && (riskLevel === "critical" || riskLevel === "at_risk")) {
      await supabase.from("email_notifications").insert({
        student_id: studentId,
        subject_id: subjectId,
        risk_level: riskLevel,
        channel: "email",
      });
    }

    return new Response(JSON.stringify({ success: true, id: result.id }), {
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

