import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type ParentEmailType = "invitation" | "request_received" | "approved" | "rejected";

function safeString(s: unknown): string | null {
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

function normalizeEmail(s: unknown): string | null {
  const t = safeString(s);
  if (!t) return null;
  return t;
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
    const msg = (result && (result.message || result.error)) ? (result.message || result.error) : `Brevo error (${res.status})`;
    throw new Error(msg);
  }
  return result as { messageId?: string };
}

function buildEmail(
  type: ParentEmailType,
  opts: { parentName?: string | null; studentName?: string | null; studentIdNo?: string | null },
): { subject: string; html: string } {
  const parentName = opts.parentName?.trim() || "Parent/Guardian";
  const studentName = opts.studentName?.trim() || "student";
  const studentIdNo = opts.studentIdNo?.trim();

  switch (type) {
    case "invitation":
      return {
        subject: "EDGE: Create your parent/guardian account",
        html: `<p>Hello,</p>
<p>Your child registered on the <strong>EDGE Student Risk Analysis and AI Coaching System</strong> and listed you as a parent/guardian.</p>
${studentIdNo ? `<p>When creating your parent account, use your child's Student ID/No.: <strong>${studentIdNo}</strong>.</p>` : ""}
<p>After registering, the student will be asked to approve your access request before you can view their academic information.</p>
<p>Sign up at the EDGE platform: <a href="${appUrl}">Create parent account</a></p>
<p>– The EDGE Team</p>`,
      };
    case "request_received":
      return {
        subject: "EDGE: New parent/guardian access request",
        html: `<p>Hi ${studentName},</p>
<p><strong>${parentName}</strong> has requested permission to view your academic information on the EDGE platform.</p>
<p>Open <strong>Parent Access Requests</strong> in your dashboard to approve or reject this request.</p>
<p>– The EDGE Team</p>`,
      };
    case "approved":
      return {
        subject: "EDGE: Access request approved",
        html: `<p>Hi ${parentName},</p>
<p>Your request to access <strong>${studentName}</strong>'s academic information has been <strong>approved</strong>.</p>
<p>You can now view their performance from the <strong>Student Performance</strong> page.</p>
<p>– The EDGE Team</p>`,
      };
    case "rejected":
      return {
        subject: "EDGE: Access request rejected",
        html: `<p>Hi ${parentName},</p>
<p>Your request to access <strong>${studentName}</strong>'s academic information was <strong>not approved</strong> by the student.</p>
<p>You may submit a new request at a later time.</p>
<p>– The EDGE Team</p>`,
      };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");

    const body = await req.json();
    const type = safeString(body?.type) as ParentEmailType | null;
    if (!type || !["invitation", "request_received", "approved", "rejected"].includes(type)) {
      throw new Error("type must be one of invitation, request_received, approved, rejected");
    }

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

    // approved / rejected: caller must be the student on the link; recipient is the parent (resolved server-side).
    if (link.student_user_id !== user.id) throw new Error("Forbidden");
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
      ...buildEmail(type as "approved" | "rejected", {
        parentName: parentName || pProf2.full_name || null,
        studentName: studentName || sProf2?.full_name || null,
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
