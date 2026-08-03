import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type AccountStatusType = "approved" | "rejected";

function safeString(s: unknown): string | null {
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

const appUrl = (Deno.env.get("APP_URL") || "https://edge.example.com").replace(/\/+$/, "");

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
  return result as { messageId?: string };
}

function roleLabel(role: string | null | undefined): string {
  if (role === "guidance_counselor") return "Guidance Counselor";
  if (role === "instructor") return "Instructor";
  return "User";
}

function buildEmail(
  type: AccountStatusType,
  opts: { fullName?: string | null; role?: string | null },
): { subject: string; html: string } {
  const name = opts.fullName?.trim() || "Applicant";
  const label = roleLabel(opts.role);

  if (type === "approved") {
    return {
      subject: "EDGE: Your registration has been approved",
      html: `<p>Hi ${name},</p>
<p>Your registration as <strong>${label}</strong> on the <strong>EDGE Student Risk Analysis and AI Coaching System</strong> has been <strong>approved</strong> by the administrator.</p>
<p>You can now sign in to your account and access your dashboard:</p>
<p><a href="${appUrl}">${appUrl}</a></p>
<p>– The EDGE Team</p>`,
    };
  }

  return {
    subject: "EDGE: Your registration was not approved",
    html: `<p>Hi ${name},</p>
<p>Your registration as <strong>${label}</strong> on the <strong>EDGE Student Risk Analysis and AI Coaching System</strong> was <strong>not approved</strong> by the administrator.</p>
<p>If you believe this was an error or would like more information, please contact your institution's administrator.</p>
<p>– The EDGE Team</p>`,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the caller is an admin.
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");

    const { data: callerRoleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!callerRoleRow) throw new Error("Forbidden: admin role required");

    const body = await req.json();
    const userId = safeString(body?.user_id);
    const status = safeString(body?.status) as AccountStatusType | null;

    if (!userId) throw new Error("user_id is required");
    if (!status || !["approved", "rejected"].includes(status)) {
      throw new Error("status must be 'approved' or 'rejected'");
    }

    // Look up the target user's profile.
    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("user_id", userId)
      .maybeSingle();
    if (profErr) throw new Error("Could not look up user profile");
    if (!profile?.email) throw new Error("User has no email on file");

    // Look up their role (instructor or guidance_counselor only).
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["instructor", "guidance_counselor"])
      .maybeSingle();

    await sendBrevoEmail({
      to: profile.email,
      ...buildEmail(status, {
        fullName: profile.full_name,
        role: roleRow?.role ?? null,
      }),
    });

    return new Response(JSON.stringify({ success: true, type: status }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-account-status-email error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
