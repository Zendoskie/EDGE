import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAppUrl } from "../_shared/app-url.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function safeString(s: unknown): string | null {
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

function normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
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
    const msg = (result && (result.message || result.error))
      ? (result.message || result.error)
      : `Brevo error (${res.status})`;
    throw new Error(msg);
  }
}

function jsonOk(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const email = safeString(body.email);
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return new Response(JSON.stringify({ error: "A valid email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const redirectTo =
      safeString(body.redirect_to) ||
      `${resolveAppUrl(body.app_url)}/reset-password`;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const normalized = normalizeEmail(email);
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: normalized,
      options: { redirectTo },
    });

    if (error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("user not found") || msg.includes("not found")) {
        return jsonOk({ success: true, sent: false, skipped: "no_user" });
      }
      console.error("send-password-reset generateLink:", error);
      throw error;
    }

    const actionLink = data?.properties?.action_link;
    if (!actionLink) {
      console.error("send-password-reset: missing action_link", data);
      return jsonOk({ success: true, sent: false, skipped: "no_link" });
    }

    const appBase = redirectTo.replace(/\/reset-password\/?$/, "");
    const html = `<p>Hello,</p>
<p>You requested a password reset for your <strong>EDGE Student Risk Analysis and AI Coaching System</strong> account.</p>
<p><a href="${actionLink}">Reset your password</a></p>
<p>This link expires after a short time. If you did not request a reset, you can ignore this email.</p>
<p>After resetting, sign in at <a href="${appBase}/login">${appBase}/login</a>.</p>
<p>– The EDGE Team</p>`;

    await sendBrevoEmail({
      to: normalized,
      subject: "EDGE: Reset your password",
      html,
    });

    return jsonOk({ success: true, sent: 1 });
  } catch (e) {
    console.error("send-password-reset error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
