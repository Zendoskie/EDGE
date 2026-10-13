import { canonicalRiskLevel, riskLabel, type CanonicalRiskLevel } from '@/lib/risk-utils';
import { DEFAULT_SUBJECT_GRADING_WEIGHTS, roundGrade2, type SubjectGradingWeights } from '@/lib/weighted-grading';

/**
 * Official risk bands on the two-decimal weighted grade. predict-risk owns the
 * classification (supabase/functions/_shared/risk-scoring.ts); this copy is for
 * display and is parity-tested against it.
 */
export const RISK_BANDS = { excelling: 90, stable: 80, at_risk: 75 } as const;

export function classifyRiskScore(score: number | null): CanonicalRiskLevel {
  if (score == null || !Number.isFinite(score)) return 'stable';
  if (score >= RISK_BANDS.excelling) return 'excelling';
  if (score >= RISK_BANDS.stable) return 'stable';
  if (score >= RISK_BANDS.at_risk) return 'at_risk';
  return 'critical';
}

export type RiskCategory = 'activity' | 'project' | 'attendance' | 'exam';
export const RISK_CATEGORIES: RiskCategory[] = ['activity', 'project', 'attendance', 'exam'];
export const RISK_CATEGORY_LABELS: Record<RiskCategory, string> = {
  activity: 'Activities',
  project: 'Project',
  attendance: 'Attendance',
  exam: 'Exams',
};

export type CategoryCoverage = { required: RiskCategory[]; missing: RiskCategory[]; complete: boolean };

export type PredictionEvidenceRow = {
  activity_average?: number | null;
  quiz_average?: number | null;
  project_score?: number | null;
  attendance_rate?: number | null;
  laboratory_exam_average?: number | null;
  midterm_exam_average?: number | null;
  final_exam_average?: number | null;
};

const present = (v: unknown) => v != null && Number.isFinite(Number(v));

/** Coverage from a stored prediction row: every category with weight above 0 needs evidence. */
export function predictionCoverage(
  row: PredictionEvidenceRow,
  weights: SubjectGradingWeights | null | undefined,
): CategoryCoverage {
  const w = weights ?? DEFAULT_SUBJECT_GRADING_WEIGHTS;
  const evidence: Record<RiskCategory, boolean> = {
    activity: present(row.activity_average) || present(row.quiz_average),
    project: present(row.project_score),
    attendance: present(row.attendance_rate),
    exam:
      present(row.laboratory_exam_average) || present(row.midterm_exam_average) || present(row.final_exam_average),
  };
  const weightOf: Record<RiskCategory, number> = {
    activity: Number(w.activity_weight) || 0,
    project: Number(w.project_weight) || 0,
    attendance: Number(w.attendance_weight) || 0,
    exam: Number(w.exam_weight) || 0,
  };
  const required = RISK_CATEGORIES.filter((c) => weightOf[c] > 0);
  const missing = required.filter((c) => !evidence[c]);
  return { required, missing, complete: missing.length === 0 };
}

/** Official label, with the two-decimal score only when it sits in the same band. */
export function formatOfficialRiskLabel(level: unknown, score?: number | null): string {
  const canonical = canonicalRiskLevel(level);
  const label = riskLabel(canonical);
  const rounded = roundGrade2(score);
  if (rounded == null) return label;
  if (classifyRiskScore(rounded) !== canonical) return label;
  return `${label} (${rounded.toFixed(2)})`;
}
