import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type RiskLevel = "critical" | "at_risk" | "stable" | "excelling";

interface StudentMetrics {
  student_id: string;
  name: string;
  attendance_rate: number | null;
  quiz_average: number | null;
  assignment_average: number | null;
  project_score: number | null;
  activity_completion_rate: number | null;
}

function classifyStudent(metrics: StudentMetrics): { risk_level: RiskLevel; confidence: number; recommendation: string } {
  const att = metrics.attendance_rate ?? null;
  const quiz = metrics.quiz_average ?? null;
  const assign = metrics.assignment_average ?? null;
  const project = metrics.project_score ?? null;
  const completion = metrics.activity_completion_rate ?? null;

  const attPct = att != null ? att * 100 : null;
  const quizPct = quiz;
  const assignPct = assign;
  const projectPct = project;
  const avgGrade = [quizPct, assignPct, projectPct].filter((x) => x != null).length
    ? ([quizPct, assignPct, projectPct].filter((x) => x != null) as number[]).reduce((a, b) => a + b, 0) /
      ([quizPct, assignPct, projectPct].filter((x) => x != null).length)
    : null;
  const completionPct = completion != null ? completion * 100 : null;

  const reasons: string[] = [];
  let atRiskScore = 0;
  let excellingScore = 0;

  if (attPct != null) {
    if (attPct < 60) {
      atRiskScore += 3;
      reasons.push(`attendance (${attPct.toFixed(0)}%)`);
    } else if (attPct < 70) {
      atRiskScore += 2;
      reasons.push(`attendance (${attPct.toFixed(0)}%)`);
    } else if (attPct >= 90) excellingScore += 1;
  }
  if (avgGrade != null) {
    if (avgGrade < 50) {
      atRiskScore += 3;
      reasons.push(`averages (${avgGrade.toFixed(0)}%)`);
    } else if (avgGrade < 60) {
      atRiskScore += 2;
      reasons.push(`averages (${avgGrade.toFixed(0)}%)`);
    } else if (avgGrade >= 85) excellingScore += 1;
  }
  if (completionPct != null) {
    if (completionPct < 40) {
      atRiskScore += 3;
      reasons.push(`activity completion (${completionPct.toFixed(0)}%)`);
    } else if (completionPct < 50) {
      atRiskScore += 2;
      reasons.push(`activity completion (${completionPct.toFixed(0)}%)`);
    } else if (completionPct >= 80) excellingScore += 1;
  }

  // Critical: very low scores or multiple severe indicators
  if (atRiskScore >= 5 || (avgGrade != null && avgGrade < 50) || (attPct != null && attPct < 50)) {
    const recommendation =
      reasons.length > 0
        ? `Urgent: Focus on improving ${reasons.join(" and ")}. Recommend counseling, tutoring, or academic support.`
        : "Multiple critical indicators. Immediate intervention recommended.";
    return { risk_level: "critical", confidence: Math.min(0.95, 0.7 + atRiskScore * 0.05), recommendation };
  }

  if (atRiskScore >= 2) {
    const recommendation =
      reasons.length > 0
        ? `Focus on improving ${reasons.join(" and ")}. Consider office hours or tutoring.`
        : "Multiple indicators suggest risk. Review attendance and graded work.";
    return { risk_level: "at_risk", confidence: Math.min(0.95, 0.6 + atRiskScore * 0.1), recommendation };
  }

  if (excellingScore >= 2 && (attPct == null || attPct >= 85) && (avgGrade == null || avgGrade >= 80)) {
    return {
      risk_level: "excelling",
      confidence: 0.85,
      recommendation: "Strong performance. Consider mentoring peers or enrichment if available.",
    };
  }

  const stableRecommendation =
    reasons.length > 0
      ? `Monitor ${reasons.join(" and ")}. Small improvements can help.`
      : "Metrics are in a moderate range. Keep consistent effort and attendance.";
  return { risk_level: "stable", confidence: 0.75, recommendation: stableRecommendation };
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
    const msg = (result && (result.message || result.error)) ? (result.message || result.error) : `Brevo error (${res.status})`;
    throw new Error(msg);
  }
  return result as { messageId?: string };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) throw new Error("Unauthorized");

    const { data: roleCheck } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "instructor").single();
    if (!roleCheck) throw new Error("Only instructors can generate predictions");

    const { subject_id } = await req.json();
    if (!subject_id) throw new Error("subject_id is required");

    const { data: subject, error: subjectErr } = await supabase
      .from("subjects")
      .select("code, name")
      .eq("id", subject_id)
      .single();
    if (subjectErr) throw subjectErr;

    const { data: enrollments } = await supabase
      .from("enrollments")
      .select("student_id")
      .eq("subject_id", subject_id)
      .eq("status", "active");

    if (!enrollments?.length) {
      return new Response(JSON.stringify({ error: "No enrolled students found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const studentIds = enrollments.map((e) => e.student_id).filter(Boolean) as string[];

    const { data: profiles } = await supabase.from("profiles").select("user_id, full_name, email").in("user_id", studentIds);
    const profileMap = Object.fromEntries((profiles || []).map((p) => [p.user_id, { full_name: p.full_name, email: p.email }]));

    const { data: attendance } = await supabase
      .from("attendance")
      .select("student_id, status")
      .eq("subject_id", subject_id);

    const { data: activities } = await supabase
      .from("activities")
      .select("id, type, max_score, weight")
      .eq("subject_id", subject_id);

    const activityIds = (activities || []).map((a) => a.id);

    let submissions: any[] = [];
    if (activityIds.length > 0) {
      const { data } = await supabase
        .from("submissions")
        .select("student_id, activity_id, score")
        .in("activity_id", activityIds);
      submissions = data || [];
    }

    const studentMetrics: StudentMetrics[] = studentIds.map((sid) => {
      const studentAttendance = (attendance || []).filter((a) => a.student_id === sid);
      const totalClasses = studentAttendance.length;
      const presentCount = studentAttendance.filter((a) => a.status === "present" || a.status === "late").length;
      const attendanceRate = totalClasses > 0 ? presentCount / totalClasses : null;

      const studentSubs = submissions.filter((s) => s.student_id === sid);
      const activityMap: Record<string, { score: number; max: number; type: string }[]> = {};
      for (const sub of studentSubs) {
        const act = (activities || []).find((a) => a.id === sub.activity_id);
        if (!act || sub.score == null) continue;
        if (!activityMap[act.type]) activityMap[act.type] = [];
        activityMap[act.type].push({ score: sub.score, max: act.max_score, type: act.type });
      }

      const avg = (items: { score: number; max: number }[]) =>
        items.length > 0 ? items.reduce((s, i) => s + (i.score / i.max) * 100, 0) / items.length : null;

      const quizAvg = avg(activityMap["quiz"] || []);
      const assignmentAvg = avg(activityMap["assignment"] || []);
      const projectScore = avg(activityMap["project"] || []);
      const totalActivities = (activities || []).length;
      const completedActivities = studentSubs.filter((s) => s.score != null).length;
      const completionRate = totalActivities > 0 ? completedActivities / totalActivities : null;

      return {
        student_id: sid,
        name: profileMap[sid]?.full_name || "Unknown",
        attendance_rate: attendanceRate,
        quiz_average: quizAvg,
        assignment_average: assignmentAvg,
        project_score: projectScore,
        activity_completion_rate: completionRate,
      };
    });

    await supabase.from("predictions").delete().eq("subject_id", subject_id);

    const rows = studentMetrics.map((metrics) => {
      const { risk_level, confidence, recommendation } = classifyStudent(metrics);
      return {
        student_id: metrics.student_id,
        subject_id,
        prediction_type: "ai_classification",
        risk_level,
        confidence,
        recommendation,
        attendance_rate: metrics.attendance_rate,
        quiz_average: metrics.quiz_average,
        assignment_average: metrics.assignment_average,
        project_score: metrics.project_score,
        activity_completion_rate: metrics.activity_completion_rate,
      };
    });

    const { error: insertError } = await supabase.from("predictions").insert(rows);
    if (insertError) throw insertError;

    // Auto-notify critical / at-risk students (at most once per 24h per subject+risk level)
    const notifyRows = rows.filter((r) => r.risk_level === "critical" || r.risk_level === "at_risk");
    if (notifyRows.length > 0) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: alreadySent } = await supabase
        .from("email_notifications")
        .select("student_id, risk_level")
        .eq("subject_id", subject_id)
        .gte("sent_at", since);

      const sentSet = new Set((alreadySent || []).map((n: any) => `${n.student_id}:${n.risk_level}`));

      for (const n of notifyRows) {
        const key = `${n.student_id}:${n.risk_level}`;
        if (sentSet.has(key)) continue;

        const studentEmail = profileMap[n.student_id]?.email;
        if (!studentEmail) continue;

        const subj = `EDGE Alert: ${n.risk_level === "critical" ? "Critical" : "At Risk"} — ${subject.code}`;
        const html = `
          <p>Hello ${profileMap[n.student_id]?.full_name || "student"},</p>
          <p>You have been identified as <strong>${n.risk_level === "critical" ? "Critical" : "At Risk"}</strong> for <strong>${subject.code} — ${subject.name}</strong>.</p>
          <p><strong>Recommendation:</strong> ${n.recommendation || "Please check EDGE for details and reach out to your instructor."}</p>
          <p>Please log in to EDGE for more details.</p>
        `;

        try {
          await sendBrevoEmail({ to: studentEmail, subject: subj, html });
          await supabase.from("email_notifications").insert({
            student_id: n.student_id,
            subject_id,
            risk_level: n.risk_level,
            channel: "email",
          });
        } catch (e) {
          console.error("auto-notify failed:", e);
        }
      }
    }

    return new Response(JSON.stringify({ success: true, count: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("predict-risk error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
