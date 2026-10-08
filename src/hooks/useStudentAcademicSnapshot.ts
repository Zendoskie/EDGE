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
    recentActivity: [],
    atRiskSubjects: [],
    latestGradeBySubject: {},
    coaching: EMPTY_COACHING,
  };
}

type PredictionRpcRow = {
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
  laboratory_exam_average: number | null;
  comprehension_rating: number | null;
  subject_code: string | null;
  subject_name: string | null;
};

function mapPrediction(row: PredictionRpcRow) {
  return {
    ...row,
    subjects: { code: row.subject_code, name: row.subject_name },
  };
}

export async function fetchLatestStudentPredictions(userId: string) {
  const { data, error } = await supabase.rpc('latest_student_predictions', { p_student_id: userId });
  if (error) throw error;
  return ((data ?? []) as PredictionRpcRow[]).map(mapPrediction);
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
  predictions: ReturnType<typeof mapPrediction>[],
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
    subs.forEach((s: { score?: number | null; activities?: { max_score?: number } | null }) => {
      const max = s.activities && typeof s.activities === 'object' && 'max_score' in s.activities
        ? s.activities.max_score
        : 100;
      if (s.score != null && max) weighted.push((Number(s.score) / Number(max)) * 100);
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
        }
      : null,
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

  const coachingRows = predsScoped.map((row) => ({
    subject_id: row.subject_id,
    risk_level: row.risk_level,
    risk_score: row.risk_score,
    confidence: (row as { confidence?: number | null }).confidence ?? null,
    attendance_rate: (row as { attendance_rate?: number | null }).attendance_rate ?? null,
    activity_average: (row as { activity_average?: number | null }).activity_average ?? null,
    activity_completion_rate: (row as { activity_completion_rate?: number | null }).activity_completion_rate ?? null,
    quiz_average: (row as { quiz_average?: number | null }).quiz_average ?? null,
    laboratory_exam_average: (row as { laboratory_exam_average?: number | null }).laboratory_exam_average ?? null,
    comprehension_rating: (row as { comprehension_rating?: number | null }).comprehension_rating ?? null,
    recommendation: (row as { recommendation?: string | null }).recommendation ?? null,
    created_at: row.created_at,
    subjects: (row as { subjects?: { code?: string | null; name?: string | null } | null }).subjects ?? null,
  }));
  const coachingBuilt = buildStudentCoachingContext(coachingRows);
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
