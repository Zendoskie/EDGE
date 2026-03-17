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

function safeString(s: unknown): string | null {
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

function safeRiskLevel(s: unknown): RiskLevel | null {
  if (s === "critical" || s === "at_risk" || s === "stable" || s === "excelling") return s;
  return null;
}

async function sendResendEmail(opts: { to: string; subject: string; html: string }) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) throw new Error("Email not configured. Add RESEND_API_KEY to Edge Function secrets.");

  const from = Deno.env.get("RESEND_FROM") || "EDGE <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      // Use a verified domain here if you have one, e.g. "EDGE <noreply@yourdomain.com>"
      from,
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

async function sendResendBatch(emails: Array<{ to: string; subject: string; html: string }>) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) throw new Error("Email not configured. Add RESEND_API_KEY to Edge Function secrets.");
  const from = Deno.env.get("RESEND_FROM") || "EDGE <onboarding@resend.dev>";

  const payload = emails.map((e) => ({
    from,
    to: [e.to],
    subject: e.subject,
    html: e.html,
  }));

  const res = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendKey}`,
      // Allow partial success (don't fail the entire batch due to one bad email)
      "x-batch-validation": "permissive",
    },
    body: JSON.stringify(payload),
  });

  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (result && (result.message || result.error)) ? (result.message || result.error) : `Resend error (${res.status})`;
    throw new Error(msg);
  }

  return result as {
    data?: Array<{ id: string }>;
    errors?: Array<{ index: number; message: string }>;
  };
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
      const recipientsRaw = body.recipients as Array<any>;
      const recipients = recipientsRaw
        .map((r) => ({
          to: normalizeEmail(r?.to),
          studentId: safeString(r?.student_id),
          subjectId: safeString(r?.subject_id),
          riskLevel: safeRiskLevel(r?.risk_level),
        }))
        .filter((r) => !!r.to) as Array<{ to: string; studentId: string | null; subjectId: string | null; riskLevel: RiskLevel | null }>;

      if (recipients.length === 0) throw new Error("recipients must include at least one valid to email");

      const batch = await sendResendBatch(recipients.map((r) => ({ to: r.to, subject: emailSubject, html })));

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

    const result = await sendResendEmail({ to, subject: emailSubject, html });

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

