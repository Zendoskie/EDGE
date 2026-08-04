import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAppUrl } from "../_shared/app-url.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Brevo helper ─────────────────────────────────────────────────────────────

async function sendBrevoEmail(opts: { to: string; subject: string; html: string }) {
  const brevoKey = Deno.env.get("BREVO_API_KEY");
  if (!brevoKey) throw new Error("Email not configured. Add BREVO_API_KEY to Edge Function secrets.");

  const fromRaw = Deno.env.get("BREVO_FROM") || "EDGE <noreply@example.com>";
  const match = fromRaw.match(/^(.*)<(.+)>$/);
  const fromName  = match ? match[1].trim() : "EDGE";
  const fromEmail = match ? match[2].trim() : fromRaw;

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": brevoKey,
    },
    body: JSON.stringify({
      sender:      { name: fromName, email: fromEmail },
      to:          [{ email: opts.to }],
      subject:     opts.subject,
      htmlContent: opts.html,
    }),
  });

  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (result?.message || result?.error) ?? `Brevo error (${res.status})`;
    throw new Error(msg);
  }
  return result as { messageId?: string };
}

// ── Email template ────────────────────────────────────────────────────────────

function roleLabel(role: string): string {
  if (role === "guidance_counselor") return "Guidance Counselor";
  if (role === "instructor")         return "Instructor";
  return role;
}

function buildInvitationEmail(opts: {
  fullName: string;
  role: string;
  department: string | null;
  invitationUrl: string;
  expiresAt: string;
}): { subject: string; html: string } {
  const name       = opts.fullName.trim() || "Applicant";
  const label      = roleLabel(opts.role);
  const dept       = opts.department ? `<strong>${opts.department}</strong>` : "your department";
  const expiry     = new Date(opts.expiresAt).toLocaleDateString("en-PH", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });

  return {
    subject: `EDGE: Your staff account invitation`,
    html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f0f14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="padding:40px 16px;">
      <table width="560" cellpadding="0" cellspacing="0" border="0"
             style="max-width:560px;background:#1a1a24;border-radius:12px;border:1px solid #2a2a3a;overflow:hidden;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#6c47ff,#8b5cf6);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">EDGE</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">
              Student Risk Analysis and AI Coaching System
            </p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <p style="margin:0 0 6px;color:#a0a0b8;font-size:13px;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">
              Staff Account Invitation
            </p>
            <h2 style="margin:0 0 20px;color:#f0f0ff;font-size:22px;font-weight:600;">
              Hi ${name},
            </h2>
            <p style="margin:0 0 16px;color:#c8c8e0;font-size:15px;line-height:1.6;">
              Your account request has been <strong style="color:#6c47ff;">approved</strong> by an EDGE administrator.
              You have been invited to create a <strong style="color:#f0f0ff;">${label}</strong> account
              for ${dept}.
            </p>
            <p style="margin:0 0 28px;color:#c8c8e0;font-size:15px;line-height:1.6;">
              Click the button below to complete your registration. This invitation is
              <strong style="color:#f0f0ff;">single-use</strong> and expires on
              <strong style="color:#f0f0ff;">${expiry}</strong>.
            </p>

            <!-- CTA Button -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="padding:0 0 28px;">
                  <a href="${opts.invitationUrl}"
                     style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#6c47ff,#8b5cf6);
                            color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;
                            font-weight:600;letter-spacing:0.2px;">
                    Complete Registration →
                  </a>
                </td>
              </tr>
            </table>

            <!-- Fallback URL -->
            <div style="background:#11111c;border:1px solid #2a2a3a;border-radius:8px;padding:14px 16px;margin-bottom:24px;">
              <p style="margin:0 0 6px;color:#a0a0b8;font-size:11px;text-transform:uppercase;letter-spacing:0.6px;">
                Or copy this link
              </p>
              <p style="margin:0;color:#8b7cf6;font-size:12px;word-break:break-all;">${opts.invitationUrl}</p>
            </div>

            <!-- Security notes -->
            <div style="border-left:3px solid #6c47ff;padding-left:14px;">
              <p style="margin:0 0 6px;color:#c8c8e0;font-size:13px;line-height:1.5;">
                🔒 <strong style="color:#f0f0ff;">Security reminder:</strong> This link works only once.
                Do not share it with anyone.
              </p>
              <p style="margin:0;color:#c8c8e0;font-size:13px;line-height:1.5;">
                ⏰ <strong style="color:#f0f0ff;">Expiry:</strong> The link becomes invalid after
                <strong style="color:#f0f0ff;">7 days</strong> or once used — whichever comes first.
              </p>
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #2a2a3a;text-align:center;">
            <p style="margin:0;color:#606080;font-size:12px;">
              If you did not request a staff account or received this in error, you can safely ignore this email.
            </p>
            <p style="margin:8px 0 0;color:#606080;font-size:12px;">– The EDGE Team</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl        = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db                 = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the caller is an admin.
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");

    const { data: callerRole } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!callerRole) throw new Error("Forbidden: admin role required");

    // Parse request body.
    const body = await req.json();
    const invitationId = typeof body?.invitation_id === "string" ? body.invitation_id.trim() : null;
    if (!invitationId) throw new Error("invitation_id is required");

    // Prefer the caller's deployed origin (Vercel) over a localhost secret.
    const appUrl = resolveAppUrl(body?.app_url);

    // Load the invitation (with request data for the applicant's full name).
    const { data: inv, error: invErr } = await db
      .from("staff_invitations")
      .select(`
        id, email, department, role, token, status, expires_at,
        staff_registration_requests ( full_name )
      `)
      .eq("id", invitationId)
      .maybeSingle();

    if (invErr) throw new Error(`Invitation lookup failed: ${invErr.message}`);
    if (!inv)   throw new Error("Invitation not found");
    if (inv.status === "accepted") throw new Error("Invitation already accepted");

    // Build the invitation URL.
    const invitationUrl = `${appUrl}/request-staff-account?token=${inv.token}`;

    // Resolve full name from the linked request (may be null for direct invites).
    const fullName =
      (inv.staff_registration_requests as { full_name?: string } | null)?.full_name ??
      inv.email;

    const { subject, html } = buildInvitationEmail({
      fullName,
      role:          inv.role as string,
      department:    inv.department as string | null,
      invitationUrl,
      expiresAt:     inv.expires_at as string,
    });

    await sendBrevoEmail({ to: inv.email as string, subject, html });

    return new Response(
      JSON.stringify({ success: true, email: inv.email }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("send-staff-invitation error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
