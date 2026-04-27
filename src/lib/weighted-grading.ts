export type SubjectGradingWeights = {
  activity_weight: number;
  project_weight: number;
  attendance_weight: number;
  exam_weight: number;
};

export type WeightedGradeInputs = {
  activityAverage: number | null;
  projectAverage: number | null;
  attendancePercent: number | null;
  examAverage: number | null;
  weights: SubjectGradingWeights | null;
};

export function computeWeightedGrade(inputs: WeightedGradeInputs): number | null {
  const { weights } = inputs;
  if (!weights) return null;

  const parts: Array<{ value: number | null; weight: number }> = [
    { value: inputs.activityAverage, weight: Number(weights.activity_weight) || 0 },
    { value: inputs.projectAverage, weight: Number(weights.project_weight) || 0 },
    { value: inputs.attendancePercent, weight: Number(weights.attendance_weight) || 0 },
    { value: inputs.examAverage, weight: Number(weights.exam_weight) || 0 },
  ];

  const available = parts.filter((p) => p.value != null && Number.isFinite(p.value) && p.weight > 0);
  if (available.length === 0) return null;

  const totalWeight = available.reduce((sum, p) => sum + p.weight, 0);
  if (totalWeight <= 0) return null;

  const weightedSum = available.reduce((sum, p) => sum + (p.value as number) * p.weight, 0);
  return weightedSum / totalWeight;
}

export function averageOf(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}
