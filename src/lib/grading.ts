export type GradeBand = {
  min: number;
  max: number;
  label: string;
  remark: string;
};

export const STANDARD_PERCENT_GRADE_SCALE: GradeBand[] = [
  { min: 97, max: 100, label: "A+", remark: "Outstanding" },
  { min: 93, max: 96, label: "A", remark: "Excellent" },
  { min: 90, max: 92, label: "A-", remark: "Very Good" },
  { min: 87, max: 89, label: "B+", remark: "Good" },
  { min: 83, max: 86, label: "B", remark: "Above Average" },
  { min: 80, max: 82, label: "B-", remark: "Satisfactory" },
  { min: 77, max: 79, label: "C+", remark: "Fair" },
  { min: 73, max: 76, label: "C", remark: "Passing" },
  { min: 70, max: 72, label: "C-", remark: "Needs Improvement" },
  { min: 67, max: 69, label: "D+", remark: "Below Passing Standard" },
  { min: 65, max: 66, label: "D", remark: "Poor" },
  { min: 0, max: 64, label: "F", remark: "Failing" },
];

export function gradeBandFromPercent(percent: number | null | undefined): GradeBand | null {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return null;
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return STANDARD_PERCENT_GRADE_SCALE.find((band) => clamped >= band.min && clamped <= band.max) ?? null;
}
