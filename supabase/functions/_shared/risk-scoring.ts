/** Shared rule-based risk scoring — keep in sync with src/lib/risk-scoring.ts */

export type RiskLevel = "critical" | "at_risk" | "stable" | "excelling";

export const RISK_WEIGHTS = {
  academic: 0.5,
  attendance: 0.2,
  exams: 0.3,
} as const;

/**
 * Scored activities required before academic grades may produce a Crucial
 * classification. There is no earlier project threshold for this.
 * Keep in sync with src/lib/risk-scoring.ts.
 */
export const MINIMUM_GRADED_ACTIVITIES_FOR_CONFIDENT_RISK = 3;

export type RiskScoreInputs = {
  activityAverage: number | null;
  quizAverage: number | null;
  projectScore: number | null;
  attendancePercent: number | null;
  laboratoryExamAverage: number | null;
  midtermExamAverage: number | null;
  finalExamAverage: number | null;
  /** Count of scored activities behind the averages. Official prediction must pass this. */
  gradedActivityCount?: number;
};

function averageOf(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

export function computeAcademicPerformance(
  inputs: Pick<RiskScoreInputs, "activityAverage" | "quizAverage" | "projectScore">,
): number | null {
  return averageOf([inputs.activityAverage, inputs.quizAverage, inputs.projectScore]);
}

export function computeExamAverage(
  inputs: Pick<RiskScoreInputs, "laboratoryExamAverage" | "midtermExamAverage" | "finalExamAverage">,
): number | null {
  return averageOf([
    inputs.laboratoryExamAverage,
    inputs.midtermExamAverage,
    inputs.finalExamAverage,
  ]);
}

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

export function classifyRiskScore(score: number | null): RiskLevel {
  if (score == null || !Number.isFinite(score)) return "stable";
  if (score >= 90) return "excelling";
  if (score >= 75) return "stable";
  if (score >= 60) return "at_risk";
  return "critical";
}

/**
 * Sparse grades are averaged and then renormalized to the full risk score,
 * so one poor activity can fall below 60 and become Crucial. Hold that label
 * until enough scored activities exist. Attendance that is itself Crucial
 * remains valid evidence and is not forced to Stable.
 */
export function applySparseGradeSafeguard(
  level: RiskLevel,
  gradedActivityCount: number | undefined,
  attendancePercent: number | null,
): RiskLevel {
  if (
    gradedActivityCount == null ||
    !Number.isFinite(gradedActivityCount) ||
    gradedActivityCount >= MINIMUM_GRADED_ACTIVITIES_FOR_CONFIDENT_RISK
  ) {
    return level;
  }
  if (level !== "critical") return level;
  if (
    attendancePercent != null &&
    Number.isFinite(attendancePercent) &&
    classifyRiskScore(attendancePercent) === "critical"
  ) {
    return "critical";
  }
  return "at_risk";
}

export function computeRiskClassification(inputs: RiskScoreInputs): {
  risk_score: number | null;
  risk_level: RiskLevel;
  confidence: number;
  academic_performance: number | null;
  exam_average: number | null;
} {
  const academic_performance = computeAcademicPerformance(inputs);
  const exam_average = computeExamAverage(inputs);
  const risk_score = computeRiskScore(inputs);
  const risk_level = applySparseGradeSafeguard(
    classifyRiskScore(risk_score),
    inputs.gradedActivityCount,
    inputs.attendancePercent,
  );

  const componentsPresent = [
    academic_performance != null,
    inputs.attendancePercent != null,
    exam_average != null,
  ].filter(Boolean).length;

  const confidence =
    componentsPresent === 3 ? 0.95 : componentsPresent === 2 ? 0.85 : componentsPresent === 1 ? 0.7 : 0.5;

  return { risk_score, risk_level, confidence, academic_performance, exam_average };
}
