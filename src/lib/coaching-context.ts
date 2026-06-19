import { canonicalRiskLevel, riskLabel, type CanonicalRiskLevel } from '@/lib/risk-utils';

export type SubjectCoachingMetrics = {
  subjectId: string;
  subjectCode: string;
  subjectName: string | null;
  riskClassification: CanonicalRiskLevel;
  riskScore: number | null;
  attendancePercent: number | null;
  activityScorePercent: number | null;
  quizScorePercent: number | null;
  laboratoryExamPercent: number | null;
  comprehensionRating: number | null;
  systemRecommendation: string | null;
  createdAt: string | null;
};

export type StudentCoachingContext = {
  focusSubject: SubjectCoachingMetrics | null;
  subjects: SubjectCoachingMetrics[];
  atRiskSubjects: SubjectCoachingMetrics[];
};

const RISK_PRIORITY: Record<CanonicalRiskLevel, number> = {
  excelling: 0,
  stable: 1,
  at_risk: 2,
  critical: 3,
};

function predictionDateTs(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function pctFromRate(rate: number | null | undefined): number | null {
  if (rate == null || !Number.isFinite(rate)) return null;
  return rate <= 1 ? Math.round(rate * 1000) / 10 : Math.round(rate * 10) / 10;
}

function pctDirect(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

type PredictionRow = {
  subject_id?: string | null;
  risk_level?: string | null;
  risk_score?: number | null;
  confidence?: number | null;
  attendance_rate?: number | null;
  activity_average?: number | null;
  activity_completion_rate?: number | null;
  quiz_average?: number | null;
  laboratory_exam_average?: number | null;
  comprehension_rating?: number | null;
  recommendation?: string | null;
  created_at?: string | null;
  subjects?: { code?: string | null; name?: string | null } | null;
};

export function mapPredictionToCoachingMetrics(row: PredictionRow): SubjectCoachingMetrics | null {
  const subjectId = typeof row.subject_id === 'string' ? row.subject_id : null;
  if (!subjectId) return null;

  const code = row.subjects?.code ?? 'Subject';
  const name = row.subjects?.name ?? null;
  const riskClassification = canonicalRiskLevel(row.risk_level);

  const riskScore =
    row.risk_score != null && Number.isFinite(row.risk_score)
      ? Math.round(row.risk_score * 10) / 10
      : null;

  const activityScorePercent =
    pctDirect(row.activity_average) ??
    (row.activity_completion_rate != null ? pctFromRate(row.activity_completion_rate) : null);

  return {
    subjectId,
    subjectCode: code,
    subjectName: name,
    riskClassification,
    riskScore,
    attendancePercent: pctFromRate(row.attendance_rate),
    activityScorePercent,
    quizScorePercent: pctDirect(row.quiz_average),
    laboratoryExamPercent: pctDirect(row.laboratory_exam_average),
    comprehensionRating:
      row.comprehension_rating != null && Number.isFinite(row.comprehension_rating)
        ? Math.round(row.comprehension_rating * 10) / 10
        : null,
    systemRecommendation: typeof row.recommendation === 'string' ? row.recommendation : null,
    createdAt: row.created_at ?? null,
  };
}

export function buildStudentCoachingContext(rows: PredictionRow[]): StudentCoachingContext {
  const bySubject = new Map<string, PredictionRow>();
  for (const row of rows) {
    const sid = typeof row.subject_id === 'string' ? row.subject_id : null;
    if (!sid || bySubject.has(sid)) continue;
    bySubject.set(sid, row);
  }

  const subjects = Array.from(bySubject.values())
    .map(mapPredictionToCoachingMetrics)
    .filter((m): m is SubjectCoachingMetrics => m != null);

  const ranked = [...subjects].sort((a, b) => {
    const pa = RISK_PRIORITY[a.riskClassification];
    const pb = RISK_PRIORITY[b.riskClassification];
    if (pa !== pb) return pb - pa;
    return predictionDateTs(b.createdAt) - predictionDateTs(a.createdAt);
  });

  const atRiskSubjects = ranked.filter(
    (s) => s.riskClassification === 'critical' || s.riskClassification === 'at_risk',
  );

  return {
    focusSubject: ranked[0] ?? null,
    subjects: ranked,
    atRiskSubjects,
  };
}

export function formatCoachingMetricsBlock(metrics: SubjectCoachingMetrics): string {
  const lines = [
    `Subject: ${metrics.subjectCode}${metrics.subjectName ? ` — ${metrics.subjectName}` : ''}`,
    `Risk classification (system): ${riskLabel(metrics.riskClassification)}`,
    metrics.riskScore != null ? `Risk score: ${metrics.riskScore}` : null,
    metrics.attendancePercent != null ? `Attendance: ${metrics.attendancePercent}%` : null,
    metrics.activityScorePercent != null ? `Activity scores: ${metrics.activityScorePercent}%` : null,
    metrics.quizScorePercent != null ? `Quiz scores: ${metrics.quizScorePercent}%` : null,
    metrics.laboratoryExamPercent != null ? `Laboratory exam scores: ${metrics.laboratoryExamPercent}%` : null,
    metrics.comprehensionRating != null ? `Comprehension rating: ${metrics.comprehensionRating}/5` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

export function formatSubjectLabel(metrics: SubjectCoachingMetrics): string {
  return `${metrics.subjectCode}${metrics.subjectName ? ` — ${metrics.subjectName}` : ''}`.trim();
}

export function formatAtRiskSubjectLabels(metrics: SubjectCoachingMetrics[]): string[] {
  return metrics.map((m) => {
    const level = m.riskClassification === 'critical' ? 'Crucial' : 'Vulnerable';
    return `${formatSubjectLabel(m)} (${level})`;
  });
}
