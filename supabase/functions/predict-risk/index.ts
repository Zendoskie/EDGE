import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  classifyStudentRisk,
  isSubjectOwner,
  legacyAcademicPerformance,
  legacyConfidence,
  legacyExamAverage,
  planPredictionWrites,
  PREDICTION_VALUE_COLUMNS,
  type ExistingPrediction,
  type PredictionValues,
} from "../_shared/risk-scoring.ts";
import type { GradeItem, GradeWeights } from "../_shared/weighted-grading.ts";
import {
  buildRiskEmail,
  isDefinitiveRiskEmail,
  planRiskEmails,
  RISK_EMAIL_GATE_ENV,
  riskEmailKey,
  riskEmailsEnabled,
  type RiskEmailCandidate,
} from "../_shared/risk-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Postgrest and other throws are often plain objects, not `Error` — avoid returning "Unknown error". */
function serializeError(e: unknown): string {
  if (e instanceof Error) return e.message || "Error";
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const msg = typeof o.message === "string" ? o.message : "";
    const details = typeof o.details === "string" ? o.details : "";
    const hint = typeof o.hint === "string" ? o.hint : "";
    const code = typeof o.code === "string" ? o.code : "";
    const parts = [msg, details, hint].filter(Boolean);
    if (parts.length) return code ? `${parts.join(" — ")} (${code})` : parts.join(" — ");
  }
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

type RiskLevel = "critical" | "at_risk" | "stable" | "excelling";

interface StudentMetrics {
  student_id: string;
  name: string;
  attendance_rate: number | null;
  quiz_average: number | null;
  assignment_average: number | null;
  project_score: number | null;
  activity_average: number | null;
  laboratory_exam_average: number | null;
  midterm_exam_average: number | null;
  final_exam_average: number | null;
  activity_completion_rate: number | null;
  comprehension_rating: number | null;
  grade_items: GradeItem[];
}

type AssessmentType =
  | "activity"
  | "assignment"
  | "quiz"
  | "project"
  | "laboratory_exam"
  | "midterm_exam"
  | "final_exam";

const ASSESSMENT_TYPE_ALIASES: Record<string, AssessmentType> = {
  activity: "activity",
  assignment: "assignment",
  quiz: "quiz",
  project: "project",
  exam: "midterm_exam",
  laboratory_exam: "laboratory_exam",
  laboratoryexam: "laboratory_exam",
  laboratory: "laboratory_exam",
  lab_exam: "laboratory_exam",
  labexam: "laboratory_exam",
  midterm_exam: "midterm_exam",
  midtermexam: "midterm_exam",
  midterm: "midterm_exam",
  final_exam: "final_exam",
  finalexam: "final_exam",
  final: "final_exam",
};

function normalizeAssessmentType(value: unknown): AssessmentType | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ASSESSMENT_TYPE_ALIASES[key] ?? null;
}

function pct(value: number | null): string {
  return value != null && Number.isFinite(value) ? `${Math.round(value)}%` : "no data yet";
}

function buildRecommendation(opts: {
  risk_level: RiskLevel;
  risk_score: number | null;
  academic_performance: number | null;
  exam_average: number | null;
  metrics: StudentMetrics;
}): string {
  const attendancePercent = opts.metrics.attendance_rate != null ? opts.metrics.attendance_rate * 100 : null;
  const lowest = [
    { label: "academic activities", value: opts.academic_performance },
    { label: "attendance", value: attendancePercent },
    { label: "exams", value: opts.exam_average },
  ]
    .filter((item): item is { label: string; value: number } => item.value != null && Number.isFinite(item.value))
    .sort((a, b) => a.value - b.value)[0];

  if (opts.risk_level === "excelling") {
    const score = opts.risk_score != null ? `${opts.risk_score.toFixed(2)}%` : "no data yet";
    return `Maintain excellent performance. Current score is ${score}; keep the same study habits and attendance pattern.`;
  }
  if (opts.risk_level === "stable") {
    return lowest
      ? `Student is stable. Monitor ${lowest.label} (${pct(lowest.value)}) and provide light support to keep performance on track.`
      : "Student is stable. Continue regular monitoring as more grades and attendance records are added.";
  }
  if (opts.risk_level === "at_risk") {
    return lowest
      ? `Student is vulnerable. Prioritize intervention for ${lowest.label} (${pct(lowest.value)}) and schedule a follow-up after the next assessment.`
      : "Student is vulnerable. Review available grades and attendance, then schedule a support check-in.";
  }
  return lowest
    ? `Student is crucial. Immediate intervention is recommended, starting with ${lowest.label} (${pct(lowest.value)}).`
    : "Student is crucial. Immediate intervention is recommended; verify grades and attendance records for next steps.";
}

function deriveComprehensionRating(opts: {
  quiz_average: number | null;
  activity_average: number | null;
  feedbackReasons: string[];
}): number {
  const hasComprehensionConcern = opts.feedbackReasons.some((r) =>
    /difficulty understanding|understanding lessons/i.test(r)
  );
  const quiz = opts.quiz_average;
  const activity = opts.activity_average;
  const gap =
    quiz != null && activity != null && activity > quiz + 12
      ? true
      : quiz != null && quiz < 55;

  if (hasComprehensionConcern || gap) return 2;
  if (quiz != null && quiz < 70) return 3;
  if (quiz != null && quiz >= 85 && (activity == null || activity >= 80)) return 5;
  return 4;
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
      .select(
        "code, name, instructor_id, subject_grading_systems(activity_weight, project_weight, attendance_weight, exam_weight)",
      )
      .eq("id", subject_id)
      .maybeSingle();
    if (subjectErr) {
      console.error("predict-risk subject fetch:", subjectErr);
      throw subjectErr;
    }
    // Service-role client bypasses RLS, so ownership is enforced here before any other read, write or email.
    if (!isSubjectOwner(subject, user.id)) {
      return new Response(JSON.stringify({ error: "You can only recalculate risk for subjects you teach." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const embeddedWeights = (subject as { subject_grading_systems?: GradeWeights | GradeWeights[] | null })
      .subject_grading_systems;
    // Null means no saved row: the Phase 1 default weights apply.
    const gradingWeights: GradeWeights | null = Array.isArray(embeddedWeights)
      ? embeddedWeights[0] ?? null
      : embeddedWeights ?? null;

    const { data: enrollments, error: enrollmentsErr } = await supabase
      .from("enrollments")
      .select("student_id")
      .eq("subject_id", subject_id)
      .eq("status", "active");
    if (enrollmentsErr) throw enrollmentsErr;

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

    let submissions: Array<{ student_id: string; activity_id: string; score: number | null; assessment_type: string | null }> = [];
    if (activityIds.length > 0) {
      const { data } = await supabase
        .from("submissions")
        .select("student_id, activity_id, score, assessment_type")
        .in("activity_id", activityIds);
      submissions = data || [];
    }

    const { data: feedbackRows } = await supabase
      .from("student_feedback")
      .select("student_id, reasons, created_at")
      .eq("subject_id", subject_id)
      .order("created_at", { ascending: false });

    const latestFeedbackByStudent = new Map<string, string[]>();
    for (const row of feedbackRows ?? []) {
      const sid = row.student_id as string | undefined;
      if (!sid || latestFeedbackByStudent.has(sid)) continue;
      latestFeedbackByStudent.set(sid, Array.isArray(row.reasons) ? row.reasons.map(String) : []);
    }

    const studentMetrics: StudentMetrics[] = studentIds.map((sid) => {
      const studentAttendance = (attendance || []).filter((a) => a.student_id === sid);
      const totalClasses = studentAttendance.length;
      const presentCount = studentAttendance.filter((a) => a.status === "present" || a.status === "late").length;
      const attendanceRate = totalClasses > 0 ? presentCount / totalClasses : null;

      const studentSubs = submissions.filter((s) => s.student_id === sid);
      const gradeItems: GradeItem[] = [];
      const activityMap: Record<AssessmentType, { score: number; max: number }[]> = {
        activity: [],
        assignment: [],
        quiz: [],
        project: [],
        laboratory_exam: [],
        midterm_exam: [],
        final_exam: [],
      };
      for (const sub of studentSubs) {
        const act = (activities || []).find((a) => a.id === sub.activity_id);
        if (!act || sub.score == null) continue;
        gradeItems.push({ type: act.type, assessmentType: sub.assessment_type, score: sub.score, maxScore: act.max_score });
        const assessmentType = normalizeAssessmentType(sub.assessment_type) ?? normalizeAssessmentType(act.type);
        const score = Number(sub.score);
        const max = Number(act.max_score);
        if (!assessmentType || !Number.isFinite(score) || !Number.isFinite(max) || max <= 0) continue;
        activityMap[assessmentType].push({ score, max });
      }

      const avg = (items: { score: number; max: number }[]) =>
        items.length > 0 ? items.reduce((s, i) => s + (i.score / i.max) * 100, 0) / items.length : null;

      const mergeAvg = (...values: Array<number | null>) => {
        const valid = values.filter((v): v is number => v != null && Number.isFinite(v));
        return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
      };

      const quizAvg = avg(activityMap.quiz);
      const assignmentAvg = avg(activityMap.assignment);
      const projectScore = avg(activityMap.project);
      const rawActivityAvg = avg(activityMap.activity);
      const activityAvg = mergeAvg(rawActivityAvg, assignmentAvg);
      const labExamAvg = avg(activityMap.laboratory_exam);
      const midtermExamAvg = avg(activityMap.midterm_exam);
      const finalExamAvg = avg(activityMap.final_exam);
      const totalActivities = (activities || []).length;
      const completedActivities = studentSubs.filter((s) => s.score != null).length;
      const completionRate = totalActivities > 0 ? completedActivities / totalActivities : null;
      const feedbackReasons = latestFeedbackByStudent.get(sid) ?? [];
      const comprehensionRating = deriveComprehensionRating({
        quiz_average: quizAvg,
        activity_average: activityAvg,
        feedbackReasons,
      });

      return {
        student_id: sid,
        name: profileMap[sid]?.full_name || "Unknown",
        attendance_rate: attendanceRate,
        quiz_average: quizAvg,
        assignment_average: assignmentAvg,
        project_score: projectScore,
        activity_average: activityAvg,
        laboratory_exam_average: labExamAvg,
        midterm_exam_average: midtermExamAvg,
        final_exam_average: finalExamAvg,
        activity_completion_rate: completionRate,
        comprehension_rating: comprehensionRating,
        grade_items: gradeItems,
      };
    });

    // Must succeed: without the stored rows, ids could not be kept stable.
    const { data: existingPreds, error: existingErr } = await supabase
      .from("predictions")
      .select(`id, created_at, student_id, subject_id, ${PREDICTION_VALUE_COLUMNS.join(", ")}`)
      .eq("subject_id", subject_id);
    if (existingErr) throw existingErr;

    const emailCandidates: RiskEmailCandidate[] = [];
    const rows: PredictionValues[] = studentMetrics.map((metrics) => {
      const attendancePercent = metrics.attendance_rate != null ? metrics.attendance_rate * 100 : null;
      const { risk_score, band, risk_level, coverage, grade } = classifyStudentRisk({
        items: metrics.grade_items,
        attendancePercent,
        weights: gradingWeights,
      });
      emailCandidates.push({ student_id: metrics.student_id, risk_level, risk_score, coverage });
      const academic_performance = legacyAcademicPerformance({
        activityAverage: metrics.activity_average,
        quizAverage: metrics.quiz_average,
        projectScore: metrics.project_score,
      });
      const exam_average = legacyExamAverage({
        laboratoryExamAverage: metrics.laboratory_exam_average,
        midtermExamAverage: metrics.midterm_exam_average,
        finalExamAverage: metrics.final_exam_average,
      });
      const confidence = legacyConfidence({ academicPerformance: academic_performance, attendancePercent, examAverage: exam_average });
      console.log("risk-score breakdown", {
        student_id: metrics.student_id,
        subject_id,
        activity_average: grade.activityAverage,
        project_average: grade.projectAverage,
        attendance_percent: attendancePercent,
        exam_average: grade.examAverage,
        weights: gradingWeights ?? "default",
        risk_score,
        band,
        risk_level,
        missing_categories: coverage.missing,
      });
      return {
        student_id: metrics.student_id,
        subject_id,
        prediction_type: "risk_analysis",
        risk_level,
        confidence,
        risk_score,
        recommendation: buildRecommendation({
          risk_level,
          risk_score,
          academic_performance,
          exam_average,
          metrics,
        }),
        attendance_rate: metrics.attendance_rate,
        quiz_average: metrics.quiz_average,
        assignment_average: metrics.assignment_average,
        project_score: metrics.project_score,
        activity_average: metrics.activity_average,
        laboratory_exam_average: metrics.laboratory_exam_average,
        midterm_exam_average: metrics.midterm_exam_average,
        final_exam_average: metrics.final_exam_average,
        exam_average,
        academic_performance,
        activity_completion_rate: metrics.activity_completion_rate,
        comprehension_rating: metrics.comprehension_rating,
      };
    });

    const plan = planPredictionWrites((existingPreds ?? []) as unknown as ExistingPrediction[], rows, {
      now: new Date().toISOString(),
      newId: () => crypto.randomUUID(),
    });

    if (plan.upserts.length > 0) {
      // predictions_pkey (id) is the table's only unique key.
      const { error: upsertError } = await supabase.from("predictions").upsert(plan.upserts, { onConflict: "id" });
      if (upsertError) {
        console.error("predict-risk predictions upsert:", upsertError);
        throw upsertError;
      }
    }

    if (plan.deleteIds.length > 0) {
      const { error: deleteError } = await supabase
        .from("predictions")
        .delete()
        .eq("subject_id", subject_id)
        .in("id", plan.deleteIds);
      if (deleteError) console.error("predict-risk stale/duplicate cleanup:", deleteError);
    }

    // Auto-email Crucial / Vulnerable students only when the rollout gate is on and the evidence is complete
    // (at most once per 24h per subject+risk level). Stored predictions and in-app notices are unaffected.
    const riskEmailsOn = riskEmailsEnabled(Deno.env.get(RISK_EMAIL_GATE_ENV));
    if (riskEmailsOn && emailCandidates.some(isDefinitiveRiskEmail)) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: alreadySent } = await supabase
        .from("email_notifications")
        .select("student_id, risk_level")
        .eq("subject_id", subject_id)
        .gte("sent_at", since);

      const sentSet = new Set((alreadySent ?? []).map(riskEmailKey));
      const notifyRows = planRiskEmails({ enabled: riskEmailsOn, candidates: emailCandidates, alreadySent: sentSet });

      for (const n of notifyRows) {
        const studentEmail = profileMap[n.student_id]?.email;
        if (!studentEmail) continue;

        const { subject: subj, html } = buildRiskEmail({
          riskLevel: n.risk_level,
          studentName: profileMap[n.student_id]?.full_name,
          subjectCode: subject.code,
          subjectName: subject.name,
        });

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

    return new Response(JSON.stringify({
        success: true,
        count: rows.length,
        written: plan.upserts.length,
        unchanged: plan.unchanged,
        removed: plan.deleteIds.length,
      }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = serializeError(e);
    console.error("predict-risk error:", message, e);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
