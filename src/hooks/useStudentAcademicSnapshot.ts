import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  filterAttendanceBySubjectIds,
  filterPredictionsBySubjectIds,
  filterSubmissionsByActiveSubjects,
  pickLatestPredictionByCreatedAt,
  resolveStudentRiskSummary,
} from '@/lib/student-performance-scope';
import { PREDICTION_EVIDENCE_COLUMNS, type RiskEvidenceRow } from '@/lib/risk-scoring';
import { gradeItemPercent, type SubjectGradingWeights } from '@/lib/weighted-grading';
import {
  buildStudentCoachingContext,
  formatAtRiskSubjectLabels,
  formatSubjectLabel,
  type SubjectCoachingMetrics,
} from '@/lib/coaching-context';

export type StudentAcademicSnapshot = {
  enrolledSubjects: number;
  attendanceRate: string;
  overallAverage: string;
  riskStatus: string;
  riskLevel: string | null;
  recommendation: string | null;
  subjectLabel: string | null;
  riskSource: 'prediction' | 'derived';
  riskScore: number | null;
  /** The latest prediction row, with every PREDICTION_EVIDENCE_COLUMNS column. */
  riskEvidence: RiskEvidenceRow | null;
  /** That subject's saved weights; null means defaults apply, undefined means unknown. */
  riskWeights: SubjectGradingWeights | null | undefined;
  recentActivity: Array<Record<string, unknown>>;
  atRiskSubjects: Array<Record<string, unknown>>;
  latestGradeBySubject: Record<string, string>;
  coaching: {
    riskLevel: string | null;
    subjectLabel: string | null;
    atRiskSubjects: string[];
    metrics: SubjectCoachingMetrics | null;
    coachingSubjects: SubjectCoachingMetrics[];
  };
};

const EMPTY_COACHING: StudentAcademicSnapshot['coaching'] = {
  riskLevel: null,
  subjectLabel: null,
  atRiskSubjects: [],
  metrics: null,
  coachingSubjects: [],
};

function emptySnapshot(): StudentAcademicSnapshot {
  return {
    enrolledSubjects: 0,
    attendanceRate: '—',
    overallAverage: '—',
    riskStatus: '—',
    riskLevel: null,
    recommendation: null,
    subjectLabel: null,
    riskSource: 'derived',
    riskScore: null,
    riskEvidence: null,
    riskWeights: undefined,
    recentActivity: [],
    atRiskSubjects: [],
    latestGradeBySubject: {},
    coaching: EMPTY_COACHING,
  };
}

type PredictionRow = {
  id: string;
  subject_id: string;
  risk_level: string;
  risk_score: number | null;
  recommendation: string | null;
  created_at: string | null;
  confidence: number | null;
  attendance_rate: number | null;
  activity_average: number | null;
  activity_completion_rate: number | null;
  quiz_average: number | null;
  project_score: number | null;
  laboratory_exam_average: number | null;
  midterm_exam_average: number | null;
  final_exam_average: number | null;
  comprehension_rating: number | null;
  subjects: {
    code: string | null;
    name: string | null;
    subject_grading_systems: SubjectGradingWeights | SubjectGradingWeights[] | null;
  } | null;
};

/**
 * One request under the "Students can view own predictions" and enrolled-subject grading RLS policies.
 * latest_student_predictions omits project and Midterm/Final evidence, so it cannot verify a risk status.
 */
const LATEST_PREDICTION_SELECT = `id, subject_id, risk_level, recommendation, created_at, confidence, activity_completion_rate, comprehension_rating, ${PREDICTION_EVIDENCE_COLUMNS}, subjects(code, name, subject_grading_systems(activity_weight, project_weight, attendance_weight, exam_weight))`;

/**
 * Latest row per subject, like the RPC's DISTINCT ON. `grading_weights`: the saved row, `null` when the
 * subject has none (defaults apply), or `undefined` when the subject itself was not returned.
 */
export function latestPredictionsBySubject(rows: PredictionRow[]) {
  const latest = new Map<string, PredictionRow>();
  for (const row of rows) {
    if (!row.subject_id) continue;
    const prev = latest.get(row.subject_id);
    if (!prev || Date.parse(row.created_at ?? '') > Date.parse(prev.created_at ?? '')) latest.set(row.subject_id, row);
  }
  return Array.from(latest.values()).map(({ subjects, ...row }) => {
    const saved = subjects?.subject_grading_systems;
    const grading_weights: SubjectGradingWeights | null | undefined = !subjects
      ? undefined
      : (Array.isArray(saved) ? saved[0] : saved) ?? null;
    return { ...row, subjects: { code: subjects?.code ?? null, name: subjects?.name ?? null }, grading_weights };
  });
}

export async function fetchLatestStudentPredictions(userId: string) {
  const { data, error } = await supabase
    .from('predictions')
    .select(LATEST_PREDICTION_SELECT)
    .eq('student_id', userId)
    .not('subject_id', 'is', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return latestPredictionsBySubject((data ?? []) as unknown as PredictionRow[]);
}

export function useLatestStudentPredictions(userId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['latest-student-predictions', userId],
    queryFn: () => fetchLatestStudentPredictions(userId!),
    enabled: !!userId && enabled,
    staleTime: 60_000,
  });
}

async function loadSnapshot(
  userId: string,
  subjectIds: string[],
  predictions: ReturnType<typeof latestPredictionsBySubject>,
): Promise<StudentAcademicSnapshot> {
  if (subjectIds.length === 0) return emptySnapshot();

  const subjectSet = new Set(subjectIds);
  const [attendanceRes, submissionsRes] = await Promise.all([
    supabase.from('attendance').select('status, subject_id').eq('student_id', userId),
    supabase
      .from('submissions')
      .select(
        'id, score, graded_at, submitted_at, activity_id, assessment_type, activities(id, title, type, max_score, subject_id, subjects(code, name))',
      )
      .eq('student_id', userId)
      .order('graded_at', { ascending: false, nullsFirst: false }),
  ]);

  if (attendanceRes.error) throw attendanceRes.error;
  if (submissionsRes.error) throw submissionsRes.error;

  const submissions = submissionsRes.data ?? [];

  const attRecords = filterAttendanceBySubjectIds(attendanceRes.data ?? [], subjectSet);
  const total = attRecords.length;
  const present = attRecords.filter((a) => a.status === 'present' || a.status === 'late').length;
  const attendanceRateNum = total > 0 ? Math.round((present / total) * 100) : null;

  const subs = filterSubmissionsByActiveSubjects(submissions, subjectSet);
  let overallAvg: number | null = null;
  if (subs.length) {
    const weighted: number[] = [];
    subs.forEach((s: {
      score?: number | null;
      assessment_type?: string | null;
      activities?: { max_score?: number; type?: string } | null;
    }) => {
      const act = s.activities && typeof s.activities === 'object' ? s.activities : null;
      const max = act && 'max_score' in act ? act.max_score : 100;
      if (s.score == null || !max) return;
      const pct = gradeItemPercent({
        type: act?.type,
        assessmentType: s.assessment_type ?? act?.type,
        score: s.score,
        maxScore: max,
      });
      if (pct != null) weighted.push(pct);
    });
    overallAvg = weighted.length ? Math.round(weighted.reduce((a, b) => a + b, 0) / weighted.length) : null;
  }

  const predsScoped = filterPredictionsBySubjectIds(predictions, subjectSet);
  const pred = pickLatestPredictionByCreatedAt(predsScoped);
  const summary = resolveStudentRiskSummary({
    overallAveragePercent: overallAvg,
    attendanceRatePercent: attendanceRateNum,
    latestPrediction: pred
      ? {
          risk_level: pred.risk_level,
          created_at: pred.created_at,
          recommendation: (pred as { recommendation?: string | null }).recommendation ?? null,
          subjects: (pred as { subjects?: { code?: string; name?: string | null } | null }).subjects ?? null,
          evidence: pred,
        }
      : null,
    weights: pred?.grading_weights,
  });

  const latestBySubject = new Map<string, (typeof predsScoped)[number]>();
  for (const row of predsScoped) {
    if (!row.subject_id) continue;
    const existing = latestBySubject.get(row.subject_id);
    if (!existing) {
      latestBySubject.set(row.subject_id, row);
      continue;
    }
    const nextTs = Date.parse(String(row.created_at ?? ''));
    const prevTs = Date.parse(String(existing.created_at ?? ''));
    if (Number.isFinite(nextTs) && (!Number.isFinite(prevTs) || nextTs > prevTs)) {
      latestBySubject.set(row.subject_id, row);
    }
  }
  const atRiskSubjects = Array.from(latestBySubject.values()).filter(
    (p) => p.risk_level === 'critical' || p.risk_level === 'at_risk',
  );

  const latestGradeBySubject: Record<string, string> = {};
  for (const row of submissions) {
    if (row.score == null) continue;
    const sid = (row as { activities?: { subject_id?: string } | null }).activities?.subject_id;
    if (typeof sid !== 'string' || !subjectSet.has(sid) || latestGradeBySubject[sid]) continue;
    const stamp = row.graded_at ?? row.submitted_at ?? null;
    if (typeof stamp === 'string' && stamp) latestGradeBySubject[sid] = stamp;
  }

  const coachingBuilt = buildStudentCoachingContext(predsScoped);
  const focus = coachingBuilt.focusSubject;
  const coaching = focus
    ? {
        riskLevel: focus.riskClassification,
        subjectLabel:
          coachingBuilt.atRiskSubjects.length > 1
            ? `${coachingBuilt.atRiskSubjects.length} subjects need attention`
            : formatSubjectLabel(focus),
        atRiskSubjects: formatAtRiskSubjectLabels(coachingBuilt.atRiskSubjects),
        metrics: focus,
        coachingSubjects: coachingBuilt.subjects,
      }
    : EMPTY_COACHING;

  return {
    enrolledSubjects: subjectIds.length,
    attendanceRate: attendanceRateNum != null ? `${attendanceRateNum}%` : '—',
    overallAverage: overallAvg != null ? `${overallAvg}%` : '—',
    riskStatus: summary.riskStatusLabel,
    riskLevel: summary.resolvedLevel,
    recommendation: summary.recommendation,
    subjectLabel: summary.subjectLabel,
    riskSource: summary.riskSource,
    riskScore:
      pred?.risk_score != null && Number.isFinite(Number(pred.risk_score)) ? Number(pred.risk_score) : null,
    riskEvidence: pred ?? null,
    riskWeights: pred?.grading_weights,
    recentActivity: filterSubmissionsByActiveSubjects(submissions, subjectSet).slice(0, 5) as Array<
      Record<string, unknown>
    >,
    atRiskSubjects: atRiskSubjects as Array<Record<string, unknown>>,
    latestGradeBySubject,
    coaching,
  };
}

export function useStudentAcademicSnapshot(
  userId: string | undefined,
  subjectIds: string[],
  enabled: boolean,
) {
  const subjectKey = subjectIds.slice().sort().join(',');
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['student-academic-snapshot', userId, subjectKey],
    queryFn: async () => {
      const predictions = await queryClient.fetchQuery({
        queryKey: ['latest-student-predictions', userId],
        queryFn: () => fetchLatestStudentPredictions(userId!),
        staleTime: 60_000,
      });
      return loadSnapshot(userId!, subjectIds, predictions);
    },
    enabled: !!userId && enabled,
    staleTime: 60_000,
  });

  const snapshot = useMemo(() => query.data ?? null, [query.data]);

  return {
    snapshot,
    isLoading: query.isLoading,
    isFetched: query.isFetched,
  };
}
