import {
  isCourseworkAssessmentType,
  isFinalExamAssessmentType,
  isMidtermSideAssessmentType,
  isProjectAssessmentType,
} from '@/lib/assessment-types';

export type SubjectGradingWeights = {
  activity_weight: number;
  project_weight: number;
  attendance_weight: number;
  exam_weight: number;
};

/** Must match the column defaults of public.subject_grading_systems. */
export const DEFAULT_SUBJECT_GRADING_WEIGHTS: SubjectGradingWeights = {
  activity_weight: 25,
  project_weight: 25,
  attendance_weight: 15,
  exam_weight: 35,
};

export type WeightedGradeInputs = {
  activityAverage: number | null;
  projectAverage: number | null;
  attendancePercent: number | null;
  examAverage: number | null;
  /** Null means the subject has no saved row; the default weights apply. */
  weights: SubjectGradingWeights | null;
};

export function computeWeightedGrade(inputs: WeightedGradeInputs): number | null {
  const weights = inputs.weights ?? DEFAULT_SUBJECT_GRADING_WEIGHTS;

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

/** Effective weights equal, with no saved row (null) meaning the defaults. */
export function sameGradingWeights(
  a: SubjectGradingWeights | null | undefined,
  b: SubjectGradingWeights | null | undefined,
): boolean {
  const x = a ?? DEFAULT_SUBJECT_GRADING_WEIGHTS;
  const y = b ?? DEFAULT_SUBJECT_GRADING_WEIGHTS;
  return (['activity_weight', 'project_weight', 'attendance_weight', 'exam_weight'] as const).every(
    (k) => Number(x[k]) === Number(y[k]),
  );
}

/** Two-decimal grade used for storage, classification and display; 89.995 becomes 90. Same as the Edge copy. */
export function roundGrade2(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100 + 1e-9) / 100;
}

/** "89.60%", never rounded up into the next risk band. */
export function formatGradePercent(value: number | null | undefined): string {
  const rounded = roundGrade2(value);
  return rounded == null ? '—' : `${rounded.toFixed(2)}%`;
}

export function averageOf(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/** Base of the transmutation scale: raw 0 maps to 50%, raw max maps to 100%. */
export const TRANSMUTATION_BASE = 50;

/** Linear (score / max) × 100, or null for a missing score or invalid max. Zero is a grade. */
export function linearAssessmentPercent(score: unknown, maxScore: unknown): number | null {
  if (score == null || maxScore == null) return null;
  const s = Number(score);
  const m = Number(maxScore);
  if (!Number.isFinite(s) || !Number.isFinite(m) || m <= 0) return null;
  return (s / m) * 100;
}

/** Alias for callers that only need linear percent (e.g. score presence checks). */
export const assessmentPercent = linearAssessmentPercent;

/** Base-50 transmutation: 50 + linear/2 (raw 0 → 50, raw max → 100). */
export function transmutedAssessmentPercent(score: unknown, maxScore: unknown): number | null {
  const linear = linearAssessmentPercent(score, maxScore);
  if (linear == null) return null;
  return TRANSMUTATION_BASE + linear / 2;
}

/** Activity, project, and exams use transmutation; quiz/assignment stay linear. */
export function usesTransmutation(type: string | null | undefined): boolean {
  if (!type) return false;
  if (type === 'activity') return true;
  if (isProjectAssessmentType(type)) return true;
  if (isFinalExamAssessmentType(type)) return true;
  if (isMidtermSideAssessmentType(type)) return true;
  return false;
}

/** Percent used in category averages and weighted grades for one assessment row. */
export function gradeItemPercent(item: GradeItem): number | null {
  const type = item.assessmentType || item.type;
  if (usesTransmutation(type)) return transmutedAssessmentPercent(item.score, item.maxScore);
  return linearAssessmentPercent(item.score, item.maxScore);
}

/** Short explanation for student/instructor grade help panels. */
export const GRADING_PERCENT_HELP =
  'Activity, project, and exam scores use base-50 transmutation (raw 0 → 50%, raw max → 100%). Legacy quiz and assignment rows still use (score / max) × 100.';

/**
 * Midterm side alone until the student has a Final Exam score, then an equal split.
 * A Final with no Midterm score carries the full Exam weight (missing is not zero).
 */
export function computeExamAverage(midtermPercents: Array<number | null>, finalPercents: Array<number | null>): number | null {
  return averageOf([averageOf(midtermPercents), averageOf(finalPercents)]);
}

export type GradeItem = {
  type: string | null | undefined;
  /** Type stored on the submission; takes precedence over the activity type. */
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
  weights: SubjectGradingWeights | null;
}): SubjectWeightedGrade {
  const activity: number[] = [];
  const project: number[] = [];
  const midterm: number[] = [];
  const final: number[] = [];

  for (const item of input.items) {
    const pct = gradeItemPercent(item);
    if (pct == null) continue;
    const type = item.assessmentType || item.type;
    if (isCourseworkAssessmentType(type)) activity.push(pct);
    else if (isProjectAssessmentType(type)) project.push(pct);
    else if (isFinalExamAssessmentType(type)) final.push(pct);
    else if (isMidtermSideAssessmentType(type)) midterm.push(pct);
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
