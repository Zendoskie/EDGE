import type { CanonicalRiskLevel } from '@/lib/risk-utils';

/** Weights for the rule-based risk score (must sum to 1). */
export const RISK_WEIGHTS = {
  academic: 0.5,
  attendance: 0.2,
  exams: 0.3,
} as const;

export type RiskScoreInputs = {
  activityAverage: number | null;
  quizAverage: number | null;
  projectScore: number | null;
  attendancePercent: number | null;
  laboratoryExamAverage: number | null;
  midtermExamAverage: number | null;
  finalExamAverage: number | null;
};

export function averageOf(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/** Academic performance = average of activity, quiz, and project scores (0–100%). */
export function computeAcademicPerformance(
  inputs: Pick<RiskScoreInputs, 'activityAverage' | 'quizAverage' | 'projectScore'>,
): number | null {
  return averageOf([inputs.activityAverage, inputs.quizAverage, inputs.projectScore]);
}

/** Exam component = average of laboratory, midterm, and final exam scores (0–100%). */
export function computeExamAverage(
  inputs: Pick<RiskScoreInputs, 'laboratoryExamAverage' | 'midtermExamAverage' | 'finalExamAverage'>,
): number | null {
  return averageOf([
    inputs.laboratoryExamAverage,
    inputs.midtermExamAverage,
    inputs.finalExamAverage,
  ]);
}

/**
 * Rule-based risk score (0–100, higher = better performance):
 * (50% Academic Performance) + (20% Attendance) + (30% Exams)
 * Missing components are excluded and weights renormalized.
 */
export function computeRiskScore(inputs: RiskScoreInputs): number | null {
  const academic = computeAcademicPerformance(inputs);
  const attendance = inputs.attendancePercent;
  const exams = computeExamAverage(inputs);

  const parts = [
    { value: academic, weight: RISK_WEIGHTS.academic },
    { value: attendance, weight: RISK_WEIGHTS.attendance },
    { value: exams, weight: RISK_WEIGHTS.exams },
  ];

  const available = parts.filter((p) => p.value != null && Number.isFinite(p.value));
  if (available.length === 0) return null;

  const totalWeight = available.reduce((sum, p) => sum + p.weight, 0);
  const weightedSum = available.reduce((sum, p) => sum + (p.value as number) * p.weight, 0);
  const score = weightedSum / totalWeight;
  return Math.round(Math.min(100, Math.max(0, score)) * 10) / 10;
}

/** Map a 0–100 risk score to a classification level. */
export function classifyRiskScore(score: number | null): CanonicalRiskLevel {
  if (score == null || !Number.isFinite(score)) return 'stable';
  if (score >= 90) return 'excelling';
  if (score >= 75) return 'stable';
  if (score >= 60) return 'at_risk';
  return 'critical';
}

export type RiskClassificationResult = {
  risk_score: number | null;
  risk_level: CanonicalRiskLevel;
  confidence: number;
  academic_performance: number | null;
  exam_average: number | null;
};

export function computeRiskClassification(inputs: RiskScoreInputs): RiskClassificationResult {
  const academic_performance = computeAcademicPerformance(inputs);
  const exam_average = computeExamAverage(inputs);
  const risk_score = computeRiskScore(inputs);
  const risk_level = classifyRiskScore(risk_score);

  const componentsPresent = [
    academic_performance != null,
    inputs.attendancePercent != null,
    exam_average != null,
  ].filter(Boolean).length;

  const confidence =
    componentsPresent === 3 ? 0.95 : componentsPresent === 2 ? 0.85 : componentsPresent === 1 ? 0.7 : 0.5;

  return {
    risk_score,
    risk_level,
    confidence,
    academic_performance,
    exam_average,
  };
}
