import type { SupabaseClient } from '@supabase/supabase-js';
import type { QueryClient } from '@tanstack/react-query';
import type { Database } from '@/integrations/supabase/types';
import { canonicalRiskLevel, type CanonicalRiskLevel } from '@/lib/risk-utils';

export async function fetchActiveEnrolledSubjectIds(
  supabase: SupabaseClient<Database>,
  studentId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('enrollments')
    .select('subject_id')
    .eq('student_id', studentId)
    .eq('status', 'active');
  if (error) throw error;
  return (data ?? []).map((r) => r.subject_id).filter((id): id is string => typeof id === 'string');
}

export function getActivityFromSubmission(sub: { activities?: unknown }): {
  max_score?: number;
  subject_id?: string | null;
} | null {
  const a = sub?.activities as unknown;
  if (a == null) return null;
  if (Array.isArray(a)) return (a[0] as { max_score?: number; subject_id?: string | null }) ?? null;
  return a as { max_score?: number; subject_id?: string | null };
}

export function filterPredictionsBySubjectIds<T extends { subject_id?: string | null }>(
  rows: T[],
  subjectIds: ReadonlySet<string>,
): T[] {
  if (subjectIds.size === 0) return [];
  return rows.filter((r) => typeof r.subject_id === 'string' && subjectIds.has(r.subject_id));
}

export function filterAttendanceBySubjectIds<T extends { subject_id?: string | null }>(
  rows: T[],
  subjectIds: ReadonlySet<string>,
): T[] {
  if (subjectIds.size === 0) return [];
  return rows.filter((r) => typeof r.subject_id === 'string' && subjectIds.has(r.subject_id));
}

export function filterSubmissionsByActiveSubjects<T extends { activities?: unknown }>(
  rows: T[],
  subjectIds: ReadonlySet<string>,
): T[] {
  if (subjectIds.size === 0) return [];
  return rows.filter((s) => {
    const act = getActivityFromSubmission(s);
    return typeof act?.subject_id === 'string' && subjectIds.has(act.subject_id);
  });
}

export type StudentRiskResolutionLevel = CanonicalRiskLevel | null;

export interface LatestPredictionInput {
  risk_level: string | null | undefined;
  created_at: string | null | undefined;
  recommendation?: string | null;
  subjects?: { code?: string | null; name?: string | null } | null;
}

const PREDICTION_RECENCY_MS = 14 * 24 * 60 * 60 * 1000;

/** Headline risk: latest in-enrollment prediction within 14d merged with derived-from-grades heuristic (legacy StudentDashboard behavior). */
export function resolveStudentRiskSummary(params: {
  overallAveragePercent: number | null;
  attendanceRatePercent: number | null;
  latestPrediction: LatestPredictionInput | null;
}): {
  resolvedLevel: StudentRiskResolutionLevel;
  riskSource: 'prediction' | 'derived';
  riskStatusLabel: string;
  recommendation: string | null;
  subjectLabel: string | null;
} {
  const { overallAveragePercent: a, attendanceRatePercent: att, latestPrediction: pred } = params;

  const derivedLevel: StudentRiskResolutionLevel = (() => {
    if (a == null && att == null) return null;
    const lowScore = a != null && a < 70;
    const veryLowScore = a != null && a < 60;
    const lowAttendance = att != null && att < 75;
    const veryLowAttendance = att != null && att < 60;
    if (veryLowScore || veryLowAttendance) return 'critical';
    if (lowScore || lowAttendance) return 'at_risk';
    return 'stable';
  })();

  const predLevelRaw = pred?.risk_level ?? null;
  const predCanonical = predLevelRaw != null ? canonicalRiskLevel(predLevelRaw) : null;
  const predTs = pred?.created_at ? Date.parse(pred.created_at) : 0;
  const predIsRecent = Number.isFinite(predTs) ? Date.now() - predTs <= PREDICTION_RECENCY_MS : false;

  const resolvedLevel: StudentRiskResolutionLevel = (() => {
    if (predIsRecent && predCanonical) {
      if ((predCanonical === 'critical' || predCanonical === 'at_risk') && derivedLevel === 'stable') {
        return 'stable';
      }
      return predCanonical;
    }
    return derivedLevel ?? predCanonical;
  })();

  const riskSource: 'prediction' | 'derived' = predIsRecent && predLevelRaw ? 'prediction' : 'derived';

  const riskStatusLabel = resolvedLevel
    ? resolvedLevel === 'critical'
      ? 'Crucial'
      : resolvedLevel === 'at_risk'
        ? 'Vulnerable'
        : resolvedLevel === 'excelling'
          ? 'Excelling'
          : 'Stable'
    : '—';

  const recommendation = typeof pred?.recommendation === 'string' ? pred.recommendation : null;
  const subjects = pred?.subjects;
  const subjectLabel =
    subjects && typeof subjects.code === 'string' && subjects.code
      ? `${subjects.code}${subjects.name ? ` — ${subjects.name}` : ''}`.trim()
      : null;

  return { resolvedLevel, riskSource, riskStatusLabel, recommendation, subjectLabel };
}

export function pickLatestPredictionByCreatedAt<T extends { created_at?: string | null }>(rows: T[]): T | null {
  let best: T | null = null;
  let bestTs = -Infinity;
  for (const r of rows) {
    const t = r.created_at ? Date.parse(String(r.created_at)) : NaN;
    const ts = Number.isFinite(t) ? t : -Infinity;
    if (ts >= bestTs) {
      bestTs = ts;
      best = r;
    }
  }
  return best;
}

/** Invalidate student + parent queries after enrollment add/remove. */
export function invalidateStudentLinkedCaches(queryClient: QueryClient, studentId: string) {
  const keys: unknown[][] = [
    ['student-dashboard-stats', studentId],
    ['student-recent-activity', studentId],
    ['student-at-risk-subjects', studentId],
    ['my-predictions', studentId],
    ['my-attendance-stats', studentId],
    ['my-scores-stats', studentId],
    ['ai-insight-summary', studentId],
    ['my-subjects', studentId],
    ['student-latest-grade-by-subject', studentId],
    ['student-feedback-history', studentId],
    ['parent-student-predictions', studentId],
    ['parent-student-attendance', studentId],
    ['parent-student-submissions', studentId],
    ['parent-student-activities', studentId],
    ['parent-student-grading-systems', studentId],
    ['parent-subject-lookup', studentId],
  ];
  for (const queryKey of keys) {
    void queryClient.invalidateQueries({ queryKey });
  }
}
