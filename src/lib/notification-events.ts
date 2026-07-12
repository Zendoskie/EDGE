import { ENGAGEMENT_CONFIG } from "@/lib/engagement-config";
import {
  canonicalEngagementLevel,
  engagementLabel,
  type CanonicalEngagementLevel,
} from "@/lib/engagement-utils";
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

type EngagementSummaryLike = {
  student_id?: unknown;
  engagement_level?: unknown;
  previous_engagement_level?: unknown;
  last_login_at?: unknown;
  participation_count?: unknown;
  updated_at?: unknown;
};

const ENGAGEMENT_ORDER: CanonicalEngagementLevel[] = ["low", "moderate", "high", "very_high"];

function engagementRank(level: CanonicalEngagementLevel): number {
  return ENGAGEMENT_ORDER.indexOf(level);
}

function isSignificantEngagementDrop(
  previous: CanonicalEngagementLevel,
  current: CanonicalEngagementLevel,
): boolean {
  if (previous === "high" && current === "moderate") return true;
  if (current === "low" && previous !== "low") return true;
  return engagementRank(current) < engagementRank(previous) - 1;
}

/** Student inbox when engagement level drops. */
export function studentEngagementDropNotification(
  row: EngagementSummaryLike,
): NotificationPayload | null {
  const current = canonicalEngagementLevel(row.engagement_level);
  const previous =
    row.previous_engagement_level != null
      ? canonicalEngagementLevel(row.previous_engagement_level)
      : null;
  if (!previous || previous === current) return null;
  if (!isSignificantEngagementDrop(previous, current)) return null;

  const studentId = String(row.student_id ?? "");
  return {
    title: "Engagement level changed",
    body: `Your engagement dropped from ${engagementLabel(previous)} to ${engagementLabel(current)}. Visit your dashboard to stay on track.`,
    dedupeKey: `engagement-drop:${studentId}:${previous}->${current}`,
  };
}

/** Student inbox when inactive for configured days. */
export function studentInactivityNotification(row: EngagementSummaryLike): NotificationPayload | null {
  const lastLogin = typeof row.last_login_at === "string" ? row.last_login_at : null;
  if (!lastLogin) return null;

  const daysSince = Math.floor((Date.now() - Date.parse(lastLogin)) / (24 * 60 * 60 * 1000));
  if (daysSince < ENGAGEMENT_CONFIG.inactivityDays) return null;

  const studentId = String(row.student_id ?? "");
  return {
    title: "We miss you!",
    body: `You have not logged in for ${daysSince} days. Log in to keep your engagement on track.`,
    dedupeKey: `inactivity:${studentId}:${daysSince}`,
  };
}

/** Student inbox when no participation in configured period. */
export function studentNoParticipationNotification(
  row: EngagementSummaryLike,
): NotificationPayload | null {
  const participation = typeof row.participation_count === "number" ? row.participation_count : 0;
  if (participation > 0) return null;

  const lastLogin = typeof row.last_login_at === "string" ? row.last_login_at : null;
  if (!lastLogin) return null;

  const daysSinceLogin = Math.floor((Date.now() - Date.parse(lastLogin)) / (24 * 60 * 60 * 1000));
  if (daysSinceLogin < ENGAGEMENT_CONFIG.noParticipationDays) return null;

  const studentId = String(row.student_id ?? "");
  return {
    title: "Low course participation",
    body: `No recorded participation in the last ${ENGAGEMENT_CONFIG.noParticipationDays} days. Explore your subjects and learning materials.`,
    dedupeKey: `no-participation:${studentId}`,
  };
}

/** Instructor inbox when a student's engagement drops. */
export function instructorEngagementAlertNotification(
  row: EngagementSummaryLike,
  opts: { studentName?: string | null; subjectCode?: string | null },
): NotificationPayload | null {
  const current = canonicalEngagementLevel(row.engagement_level);
  const previous =
    row.previous_engagement_level != null
      ? canonicalEngagementLevel(row.previous_engagement_level)
      : null;
  if (!previous || previous === current) return null;
  if (!isSignificantEngagementDrop(previous, current)) return null;

  const studentId = String(row.student_id ?? "");
  const studentName = opts.studentName?.trim() || "A student";
  const code = subjectLabel(opts.subjectCode);

  return {
    title: `Student engagement dropped to ${engagementLabel(current)}`,
    body: `${studentName} (${code}) engagement changed from ${engagementLabel(previous)} to ${engagementLabel(current)}.`,
    dedupeKey: `instructor-engagement:${studentId}:${previous}->${current}`,
  };
}

/** Instructor inbox when a student submits general engagement feedback. */
export function instructorEngagementFeedbackNotification(opts: {
  feedbackId: string;
  studentName?: string | null;
  subject?: string | null;
}): NotificationPayload {
  const studentName = opts.studentName?.trim() || "A student";
  const topic = opts.subject?.trim() || "general feedback";
  return {
    title: "New student feedback",
    body: `${studentName} submitted new feedback: ${topic}.`,
    dedupeKey: `engagement-feedback:${opts.feedbackId}`,
  };
}

/** Guidance counselor inbox when a referred student submits feedback. */
export function guidanceEngagementFeedbackNotification(opts: {
  feedbackId: string;
  studentName?: string | null;
  subject?: string | null;
}): NotificationPayload {
  const studentName = opts.studentName?.trim() || "A referred student";
  const topic = opts.subject?.trim() || "general feedback";
  return {
    title: "Referred student submitted feedback",
    body: `${studentName} submitted feedback (${topic}) while a counseling referral is active.`,
    dedupeKey: `guidance-engagement-feedback:${opts.feedbackId}`,
  };
}
