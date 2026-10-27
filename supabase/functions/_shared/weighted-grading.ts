/**
 * Edge copy of the official grading math in src/lib/weighted-grading.ts and the
 * category groups in src/lib/assessment-types.ts. Pure: no Deno or network imports.
 * Locked to the official implementation by parity tests
 * (src/lib/ai-coach-context.test.ts, src/lib/risk-scoring.test.ts).
 */

export type GradeWeights = {
  activity_weight?: number | string | null;
  project_weight?: number | string | null;
  attendance_weight?: number | string | null;
  exam_weight?: number | string | null;
};

export type WeightedGradeInputs = {
  activityAverage: number | null | undefined;
  projectAverage: number | null | undefined;
  attendancePercent: number | null | undefined;
  examAverage: number | null | undefined;
  weights: GradeWeights | null | undefined;
};

/** Must match the column defaults of public.subject_grading_systems. */
export const DEFAULT_SUBJECT_GRADING_WEIGHTS = {
  activity_weight: 25,
  project_weight: 25,
  attendance_weight: 15,
  exam_weight: 35,
};

export function computeWeightedGrade(inputs: WeightedGradeInputs): number | null {
  const weights = inputs.weights ?? DEFAULT_SUBJECT_GRADING_WEIGHTS;
  const parts = [
    { value: inputs.activityAverage, weight: Number(weights.activity_weight) || 0 },
    { value: inputs.projectAverage, weight: Number(weights.project_weight) || 0 },
    { value: inputs.attendancePercent, weight: Number(weights.attendance_weight) || 0 },
    { value: inputs.examAverage, weight: Number(weights.exam_weight) || 0 },
  ];
  const available = parts.filter((p) => p.value != null && Number.isFinite(p.value) && p.weight > 0);
  if (available.length === 0) return null;
  const totalWeight = available.reduce((s, p) => s + p.weight, 0);
  if (totalWeight <= 0) return null;
  return available.reduce((s, p) => s + (p.value as number) * p.weight, 0) / totalWeight;
}

export function averageOf(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

/** Two-decimal grade used for storage, classification and display. The 1e-9 keeps 89.99499999… (a float 89.995) rounding up. */
export function roundGrade2(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100 + 1e-9) / 100;
}

const COURSEWORK_TYPES = new Set(["activity", "assignment", "quiz"]);
const PROJECT_TYPES = new Set(["project"]);
const EXAM_TYPES = new Set(["exam", "laboratory_exam", "midterm_exam", "final_exam"]);
// Legacy exam types count on the Midterm side of the Exam split.
const MIDTERM_SIDE_TYPES = new Set(["midterm_exam", "exam", "laboratory_exam"]);
const FINAL_EXAM_TYPES = new Set(["final_exam"]);

export const isCourseworkType = (v: string | null | undefined) => !!v && COURSEWORK_TYPES.has(v);
export const isProjectType = (v: string | null | undefined) => !!v && PROJECT_TYPES.has(v);
export const isExamType = (v: string | null | undefined) => !!v && EXAM_TYPES.has(v);
export const isMidtermSideType = (v: string | null | undefined) => !!v && MIDTERM_SIDE_TYPES.has(v);
export const isFinalExamType = (v: string | null | undefined) => !!v && FINAL_EXAM_TYPES.has(v);

export const TRANSMUTATION_BASE = 50;

/** Linear (score / max) × 100, or null for a missing score or invalid max. Zero is a grade. */
export function linearAssessmentPercent(score: unknown, maxScore: unknown): number | null {
  if (score == null || maxScore == null) return null;
  const s = Number(score);
  const m = Number(maxScore);
  if (!Number.isFinite(s) || !Number.isFinite(m) || m <= 0) return null;
  return (s / m) * 100;
}

export const assessmentPercent = linearAssessmentPercent;

/** Base-50 transmutation: 50 + linear/2 (raw 0 → 50, raw max → 100). */
export function transmutedAssessmentPercent(score: unknown, maxScore: unknown): number | null {
  const linear = linearAssessmentPercent(score, maxScore);
  if (linear == null) return null;
  return TRANSMUTATION_BASE + linear / 2;
}

export function usesTransmutation(type: string | null | undefined): boolean {
  if (!type) return false;
  if (type === "activity") return true;
  if (isProjectType(type)) return true;
  if (isFinalExamType(type)) return true;
  if (isMidtermSideType(type)) return true;
  return false;
}

export function gradeItemPercent(item: GradeItem): number | null {
  const type = item.assessmentType || item.type;
  if (usesTransmutation(type)) return transmutedAssessmentPercent(item.score, item.maxScore);
  return linearAssessmentPercent(item.score, item.maxScore);
}

/**
 * Midterm side alone until the student has a Final Exam score, then an equal split.
 * A Final with no Midterm score carries the full Exam weight (missing is not zero).
 */
export function computeExamAverage(midtermPercents: Array<number | null>, finalPercents: Array<number | null>): number | null {
  return averageOf([averageOf(midtermPercents), averageOf(finalPercents)]);
}

export type GradeItem = {
  type: string | null | undefined;
  assessmentType?: string | null;
  score: number | null | undefined;
  maxScore: number | null | undefined;
};

export type SubjectWeightedGrade = {
  activityAverage: number | null;
  projectAverage: number | null;
  examAverage: number | null;
  weightedAverage: number | null;
};

/** One student's weighted grade for one subject. Assessments in a category share its weight equally. */
export function computeSubjectWeightedGrade(input: {
  items: GradeItem[];
  attendancePercent: number | null;
  weights: GradeWeights | null;
}): SubjectWeightedGrade {
  const activity: number[] = [];
  const project: number[] = [];
  const midterm: number[] = [];
  const final: number[] = [];

  for (const item of input.items) {
    const pct = gradeItemPercent(item);
    if (pct == null) continue;
    const type = item.assessmentType || item.type;
    if (isCourseworkType(type)) activity.push(pct);
    else if (isProjectType(type)) project.push(pct);
    else if (isFinalExamType(type)) final.push(pct);
    else if (isMidtermSideType(type)) midterm.push(pct);
  }

  const activityAverage = averageOf(activity);
  const projectAverage = averageOf(project);
  const examAverage = computeExamAverage(midterm, final);
  return {
    activityAverage,
    projectAverage,
    examAverage,
    weightedAverage: computeWeightedGrade({
      activityAverage,
      projectAverage,
      attendancePercent: input.attendancePercent,
      examAverage,
      weights: input.weights,
    }),
  };
}
