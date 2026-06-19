import { canonicalRiskLevel, riskLabel, type CanonicalRiskLevel } from "@/lib/risk-utils";

/** Matches risk-analysis attendance concern threshold (70%). Stored as 0–1 rate in predictions. */
export const ATTENDANCE_THRESHOLD = 0.7;
export const ATTENDANCE_THRESHOLD_PCT = Math.round(ATTENDANCE_THRESHOLD * 100);

export type NotificationPayload = { title: string; body: string; dedupeKey: string };

type PredictionRowLike = {
  id?: unknown;
  student_id?: unknown;
  subject_id?: unknown;
  risk_level?: unknown;
  previous_risk_level?: unknown;
  attendance_rate?: unknown;
  previous_attendance_rate?: unknown;
  recommendation?: unknown;
};

function isAtRiskBand(level: CanonicalRiskLevel): boolean {
  return level === "critical" || level === "at_risk";
}

function attendancePct(rate: number): number {
  return rate <= 1 ? Math.round(rate * 100) : Math.round(rate);
}

function subjectLabel(code?: string | null): string {
  return code?.trim() || "your course";
}

/** Student inbox items when a new prediction row is inserted. */
export function studentPredictionNotifications(
  row: PredictionRowLike,
  subjectCode?: string | null,
): NotificationPayload[] {
  const out: NotificationPayload[] = [];
  const id = String(row.id ?? "");
  const code = subjectLabel(subjectCode);
  const riskLevel = canonicalRiskLevel(row.risk_level);
  const prevRisk =
    row.previous_risk_level != null ? canonicalRiskLevel(row.previous_risk_level) : null;

  if (prevRisk && prevRisk !== riskLevel) {
    out.push({
      title: "Risk classification changed",
      body: `${code}: your status changed from ${riskLabel(prevRisk)} to ${riskLabel(riskLevel)}. Open Performance Insights.`,
      dedupeKey: `risk-change:${id}:${prevRisk}->${riskLevel}`,
    });
  } else if (!prevRisk) {
    out.push({
      title: "Academic insight updated",
      body: `New prediction for ${code}. Open Performance Insights.`,
      dedupeKey: `pred:${id}`,
    });
  }

  const attRate = typeof row.attendance_rate === "number" ? row.attendance_rate : null;
  const prevAtt =
    typeof row.previous_attendance_rate === "number" ? row.previous_attendance_rate : null;

  if (attRate != null && attRate < ATTENDANCE_THRESHOLD) {
    const crossedBelow = prevAtt == null || prevAtt >= ATTENDANCE_THRESHOLD;
    if (crossedBelow) {
      out.push({
        title: "Attendance below threshold",
        body: `${code}: your attendance is ${attendancePct(attRate)}% (below ${ATTENDANCE_THRESHOLD_PCT}%). Review your attendance record.`,
        dedupeKey: `att-threshold:${id}:${attendancePct(attRate)}`,
      });
    }
  }

  return out;
}

/** Student inbox item when predictions.recommendation is set or updated. */
export function studentCoachingRecommendationNotification(
  row: PredictionRowLike,
  subjectCode?: string | null,
  previousRecommendation?: string | null,
): NotificationPayload | null {
  const rec = typeof row.recommendation === "string" ? row.recommendation.trim() : "";
  if (!rec) return null;
  if (previousRecommendation?.trim() === rec) return null;

  const id = String(row.id ?? "");
  const code = subjectLabel(subjectCode);
  const preview = rec.length > 140 ? `${rec.slice(0, 140)}…` : rec;

  return {
    title: "New AI coaching recommendation",
    body: `${code}: ${preview}`,
    dedupeKey: `coaching-rec:${id}:${rec.length}:${rec.slice(0, 48)}`,
  };
}

/** Instructor inbox when a student newly enters Crucial or Vulnerable status. */
export function instructorAtRiskNotification(
  row: PredictionRowLike,
  opts: { studentName?: string | null; subjectCode?: string | null },
): NotificationPayload | null {
  const riskLevel = canonicalRiskLevel(row.risk_level);
  if (!isAtRiskBand(riskLevel)) return null;

  const prevRisk =
    row.previous_risk_level != null ? canonicalRiskLevel(row.previous_risk_level) : null;
  const becameAtRisk = !prevRisk || !isAtRiskBand(prevRisk);
  if (!becameAtRisk) return null;

  const studentId = String(row.student_id ?? "");
  const subjectId = String(row.subject_id ?? "");
  const studentName = opts.studentName?.trim() || "A student";
  const code = subjectLabel(opts.subjectCode);

  return {
    title: `Student now ${riskLabel(riskLevel)}`,
    body: `${studentName} in ${code} is now classified as ${riskLabel(riskLevel)}. Review Risk Analysis.`,
    dedupeKey: `instructor-at-risk:${studentId}:${subjectId}:${riskLevel}`,
  };
}
