import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type ReferralEvent = "referral_created" | "referral_decided";

function safeString(s: unknown): string | null {
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

function normalizeEmail(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const trimmed = s.trim();
  if (!trimmed || !trimmed.includes("@")) return null;
  return trimmed;
}

function formatRiskLevel(level: string | null): string {
  if (!level) return "Unknown";
  if (level === "at_risk") return "Vulnerable";
  if (level === "critical") return "Crucial";
  if (level === "stable") return "Stable";
  if (level === "excelling") return "Excelling";
  return level;
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
  return result;
}

function buildReferralCreatedHtml(opts: {
  studentName: string;
  studentNumber: string | null;
  subjectCode: string;
  subjectName: string;
  instructorName: string;
  riskLevel: string | null;
  riskScore: number | null;
  instructorRemarks: string | null;
  isStudentRecipient: boolean;
}) {
  const riskLine = opts.riskLevel
    ? `<p><strong>Risk classification:</strong> ${formatRiskLevel(opts.riskLevel)}${
      opts.riskScore != null ? ` (${Number(opts.riskScore).toFixed(1)}/100)` : ""
    }</p>`
    : "";

  const intro = opts.isStudentRecipient
    ? `<p>Your instructor has submitted a counseling referral for <strong>${opts.subjectCode}</strong> — ${opts.subjectName}.</p>`
    : `<p>A new counseling referral requires your review for <strong>${opts.studentName}</strong>${
      opts.studentNumber ? ` (${opts.studentNumber})` : ""
    } in <strong>${opts.subjectCode}</strong> — ${opts.subjectName}.</p>`;

  const nextSteps = opts.isStudentRecipient
    ? "<p>Your guidance counselor will review this request. You will receive another notification when a decision is made.</p>"
    : "<p>Please sign in to EDGE to review the referral, student feedback, and instructor remarks.</p>";

  return `
    <div style="font-family: sans-serif; line-height: 1.5;">
      ${intro}
      <p><strong>Referred by:</strong> ${opts.instructorName}</p>
      ${riskLine}
      ${opts.instructorRemarks ? `<p><strong>Instructor remarks:</strong> ${opts.instructorRemarks}</p>` : ""}
      ${nextSteps}
      <p style="color:#666;font-size:12px;">EDGE — Student Risk Analysis and AI Coaching System</p>
    </div>
  `;
}

function buildReferralDecidedHtml(opts: {
  studentName: string;
  subjectCode: string;
  subjectName: string;
  decision: string;
  counselorRemarks: string | null;
  instructorRemarks: string | null;
  riskLevel: string | null;
  riskScore: number | null;
  isStudentRecipient: boolean;
}) {
  const decisionLabel = opts.decision === "approved" ? "approved" : "rejected";
  const intro = opts.isStudentRecipient
    ? `<p>Your counseling referral for <strong>${opts.subjectCode}</strong> — ${opts.subjectName} has been <strong>${decisionLabel}</strong>.</p>`
    : `<p>The counseling referral for <strong>${opts.studentName}</strong> in <strong>${opts.subjectCode}</strong> — ${opts.subjectName} has been <strong>${decisionLabel}</strong>.</p>`;

  const riskLine = opts.riskLevel
    ? `<p><strong>Risk classification:</strong> ${formatRiskLevel(opts.riskLevel)}${
      opts.riskScore != null ? ` (${Number(opts.riskScore).toFixed(1)}/100)` : ""
    }</p>`
    : "";

  const nextSteps = opts.decision === "approved"
    ? "<p>Counseling intervention may now proceed. Please check EDGE for details.</p>"
    : "<p>Please check EDGE for counselor remarks and next steps.</p>";

  return `
    <div style="font-family: sans-serif; line-height: 1.5;">
      ${intro}
      ${riskLine}
      ${opts.instructorRemarks ? `<p><strong>Instructor remarks:</strong> ${opts.instructorRemarks}</p>` : ""}
      ${opts.counselorRemarks ? `<p><strong>Counselor remarks:</strong> ${opts.counselorRemarks}</p>` : ""}
      ${nextSteps}
      <p style="color:#666;font-size:12px;">EDGE — Student Risk Analysis and AI Coaching System</p>
    </div>
  `;
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

    const body = await req.json();
    const event = safeString(body?.event) as ReferralEvent | null;
    const referralId = safeString(body?.referral_id);
    const counselorRemarks = safeString(body?.counselor_remarks);

    if (event !== "referral_created" && event !== "referral_decided") {
      throw new Error("event must be referral_created or referral_decided");
    }
    if (!referralId) throw new Error("referral_id is required");

    const { data: referral, error: referralError } = await supabase
      .from("counseling_referrals")
      .select(
        "id, student_id, subject_id, instructor_id, prediction_id, recommendation_message, status, counselor_remarks",
      )
      .eq("id", referralId)
      .maybeSingle();

    if (referralError) throw referralError;
    if (!referral) throw new Error("Referral not found");

    if (event === "referral_created") {
      if (referral.instructor_id !== user.id) {
        const { data: roleCheck } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "instructor")
          .maybeSingle();
        if (!roleCheck) throw new Error("Only the referring instructor can send referral_created notifications");
      }
    } else {
      const { data: roleCheck } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "guidance_counselor")
        .maybeSingle();
      if (!roleCheck) throw new Error("Only guidance counselors can send referral_decided notifications");
    }

    const profileIds = [referral.student_id, referral.instructor_id].filter(Boolean);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name, email, student_id")
      .in("user_id", profileIds);

    const studentProfile = profiles?.find((p) => p.user_id === referral.student_id);
    const instructorProfile = profiles?.find((p) => p.user_id === referral.instructor_id);

    const { data: subject } = await supabase
      .from("subjects")
      .select("code, name")
      .eq("id", referral.subject_id)
      .maybeSingle();

    let riskLevel: string | null = null;
    let riskScore: number | null = null;
    if (referral.prediction_id) {
      const { data: prediction } = await supabase
        .from("predictions")
        .select("risk_level, risk_score")
        .eq("id", referral.prediction_id)
        .maybeSingle();
      riskLevel = prediction?.risk_level ?? null;
      riskScore = prediction?.risk_score ?? null;
    }

    const subjectCode = subject?.code ?? "Subject";
    const subjectName = subject?.name ?? "";
    const studentName = studentProfile?.full_name ?? studentProfile?.email ?? "Student";
    const instructorName = instructorProfile?.full_name ?? instructorProfile?.email ?? "Instructor";
    const instructorRemarks = referral.recommendation_message ?? null;

    const emails: Array<{ to: string; subject: string; html: string }> = [];

    if (event === "referral_created") {
      const studentEmail = normalizeEmail(studentProfile?.email);
      if (studentEmail) {
        emails.push({
          to: studentEmail,
          subject: `EDGE: Counseling referral submitted — ${subjectCode}`,
          html: buildReferralCreatedHtml({
            studentName,
            studentNumber: studentProfile?.student_id ?? null,
            subjectCode,
            subjectName,
            instructorName,
            riskLevel,
            riskScore,
            instructorRemarks,
            isStudentRecipient: true,
          }),
        });
      }

      const { data: counselorRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "guidance_counselor");

      const counselorIds = (counselorRoles ?? []).map((r) => r.user_id).filter(Boolean);
      if (counselorIds.length > 0) {
        const { data: counselorProfiles } = await supabase
          .from("profiles")
          .select("user_id, email, full_name")
          .in("user_id", counselorIds);

        for (const counselor of counselorProfiles ?? []) {
          const counselorEmail = normalizeEmail(counselor.email);
          if (!counselorEmail) continue;
          emails.push({
            to: counselorEmail,
            subject: `EDGE: New counseling referral — ${subjectCode}`,
            html: buildReferralCreatedHtml({
              studentName,
              studentNumber: studentProfile?.student_id ?? null,
              subjectCode,
              subjectName,
              instructorName,
              riskLevel,
              riskScore,
              instructorRemarks,
              isStudentRecipient: false,
            }),
          });
        }
      }
    } else {
      const decision = referral.status === "approved" ? "approved" : "rejected";
      const remarks = counselorRemarks ?? referral.counselor_remarks ?? null;

      const studentEmail = normalizeEmail(studentProfile?.email);
      if (studentEmail) {
        emails.push({
          to: studentEmail,
          subject: `EDGE: Counseling referral ${decision} — ${subjectCode}`,
          html: buildReferralDecidedHtml({
            studentName,
            subjectCode,
            subjectName,
            decision,
            counselorRemarks: remarks,
            instructorRemarks,
            riskLevel,
            riskScore,
            isStudentRecipient: true,
          }),
        });
      }

      const instructorEmail = normalizeEmail(instructorProfile?.email);
      if (instructorEmail) {
        emails.push({
          to: instructorEmail,
          subject: `EDGE: Counseling referral ${decision} — ${subjectCode}`,
          html: buildReferralDecidedHtml({
            studentName,
            subjectCode,
            subjectName,
            decision,
            counselorRemarks: remarks,
            instructorRemarks,
            riskLevel,
            riskScore,
            isStudentRecipient: false,
          }),
        });
      }
    }

    const results: Array<{ to: string; success: boolean; error?: string }> = [];
    for (const email of emails) {
      try {
        await sendBrevoEmail(email);
        results.push({ to: email.to, success: true });
      } catch (err) {
        results.push({
          to: email.to,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const sent = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return new Response(
      JSON.stringify({ success: true, sent, failed, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("send-referral-notification error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
