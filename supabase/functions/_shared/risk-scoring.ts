/**
 * Official risk classification for predict-risk. Pure: no Deno or network imports.
 * The score is the Phase 1 weighted grade (./weighted-grading.ts), rounded to two
 * decimals, classified with the adviser's fixed bands. Keep RISK_BANDS and
 * classifyRiskScore in sync with src/lib/risk-scoring.ts (parity-tested).
 */
import {
  computeSubjectWeightedGrade,
  DEFAULT_SUBJECT_GRADING_WEIGHTS,
  roundGrade2,
  type GradeItem,
  type GradeWeights,
  type SubjectWeightedGrade,
} from "./weighted-grading.ts";

export type RiskLevel = "critical" | "at_risk" | "stable" | "excelling";

/** Lower bounds of each band, applied to the two-decimal score. Below `at_risk` is `critical`. */
export const RISK_BANDS = { excelling: 90, stable: 80, at_risk: 75 } as const;

/** No score (no evidence at all) stays `stable`: risk_level is NOT NULL and has no "unknown" value. */
export function classifyRiskScore(score: number | null): RiskLevel {
  if (score == null || !Number.isFinite(score)) return "stable";
  if (score >= RISK_BANDS.excelling) return "excelling";
  if (score >= RISK_BANDS.stable) return "stable";
  if (score >= RISK_BANDS.at_risk) return "at_risk";
  return "critical";
}

export type RiskCategory = "activity" | "project" | "attendance" | "exam";
export const RISK_CATEGORIES: RiskCategory[] = ["activity", "project", "attendance", "exam"];

export type CategoryCoverage = { required: RiskCategory[]; missing: RiskCategory[]; complete: boolean };

/** Every category with an effective weight above 0 must have evidence. */
export function categoryCoverage(
  weights: GradeWeights | null | undefined,
  evidence: Record<RiskCategory, boolean>,
): CategoryCoverage {
  const w = weights ?? DEFAULT_SUBJECT_GRADING_WEIGHTS;
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

/** Without full coverage, Crucial is held at Vulnerable and Excelling at Stable. */
export function applyCoverageGuard(band: RiskLevel, coverageComplete: boolean): RiskLevel {
  if (coverageComplete) return band;
  if (band === "critical") return "at_risk";
  if (band === "excelling") return "stable";
  return band;
}

export type StudentRiskResult = {
  grade: SubjectWeightedGrade;
  risk_score: number | null;
  band: RiskLevel;
  risk_level: RiskLevel;
  coverage: CategoryCoverage;
};

export function classifyStudentRisk(input: {
  items: GradeItem[];
  attendancePercent: number | null;
  weights: GradeWeights | null;
}): StudentRiskResult {
  const grade = computeSubjectWeightedGrade(input);
  const risk_score = roundGrade2(grade.weightedAverage);
  const band = classifyRiskScore(risk_score);
  const coverage = categoryCoverage(input.weights, {
    activity: grade.activityAverage != null,
    project: grade.projectAverage != null,
    attendance: input.attendancePercent != null && Number.isFinite(input.attendancePercent),
    exam: grade.examAverage != null,
  });
  return { grade, risk_score, band, risk_level: applyCoverageGuard(band, coverage.complete), coverage };
}

/* ------------------------------------------------ legacy diagnostics (not used for classification) */

function averageOf(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/** predictions.academic_performance: average of activity, quiz and project averages. */
export function legacyAcademicPerformance(v: {
  activityAverage: number | null;
  quizAverage: number | null;
  projectScore: number | null;
}): number | null {
  return averageOf([v.activityAverage, v.quizAverage, v.projectScore]);
}

/** predictions.exam_average: average of laboratory, midterm and final exam averages. */
export function legacyExamAverage(v: {
  laboratoryExamAverage: number | null;
  midtermExamAverage: number | null;
  finalExamAverage: number | null;
}): number | null {
  return averageOf([v.laboratoryExamAverage, v.midtermExamAverage, v.finalExamAverage]);
}

/** predictions.confidence: share of academic, attendance and exam evidence present (unchanged meaning). */
export function legacyConfidence(v: {
  academicPerformance: number | null;
  attendancePercent: number | null;
  examAverage: number | null;
}): number {
  const present = [v.academicPerformance, v.attendancePercent, v.examAverage].filter((x) => x != null).length;
  return present === 3 ? 0.95 : present === 2 ? 0.85 : present === 1 ? 0.7 : 0.5;
}

/* ------------------------------------------------ authorization */

export function isSubjectOwner(subject: { instructor_id?: string | null } | null | undefined, userId: string): boolean {
  return !!subject && !!userId && subject.instructor_id === userId;
}

/* ------------------------------------------------ persistence planning */

/** Columns predict-risk writes and compares. Excludes id, created_at and previous_*. */
export const PREDICTION_VALUE_COLUMNS = [
  "prediction_type",
  "risk_level",
  "confidence",
  "risk_score",
  "recommendation",
  "attendance_rate",
  "quiz_average",
  "assignment_average",
  "project_score",
  "activity_average",
  "laboratory_exam_average",
  "midterm_exam_average",
  "final_exam_average",
  "exam_average",
  "academic_performance",
  "activity_completion_rate",
  "comprehension_rating",
] as const;

export type PredictionValues = { student_id: string; subject_id: string } & Record<
  (typeof PREDICTION_VALUE_COLUMNS)[number],
  string | number | null
>;

export type ExistingPrediction = Partial<PredictionValues> & {
  id: string;
  student_id: string | null;
  created_at: string | null;
};

export type PredictionWrite = PredictionValues & {
  id: string;
  created_at: string;
  previous_risk_level: string | null;
  previous_attendance_rate: number | null;
};

function sameValue(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === "number" || typeof b === "number") {
    const x = Number(a);
    const y = Number(b);
    return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 1e-9;
  }
  return a === b;
}

function newestFirst(a: ExistingPrediction, b: ExistingPrediction): number {
  const diff = (Date.parse(b.created_at ?? "") || 0) - (Date.parse(a.created_at ?? "") || 0);
  return diff !== 0 ? diff : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Stable-id write plan for one subject. `existing` must be every prediction row of
 * that subject; `computed` one row per actively enrolled student.
 * - Existing student, values unchanged: no write (previous_* and created_at kept).
 * - Existing student, values changed: same id, created_at = now, previous_* = stored values.
 * - New student: new id, previous_* null.
 * - Deletes only rows positively identified as stale (student not actively enrolled)
 *   or as older duplicates of the same student in this subject.
 */
export function planPredictionWrites(
  existing: ExistingPrediction[],
  computed: PredictionValues[],
  opts: { now: string; newId: () => string },
): { upserts: PredictionWrite[]; deleteIds: string[]; unchanged: number } {
  const byStudent = new Map<string, ExistingPrediction[]>();
  for (const row of existing) {
    if (!row.id || !row.student_id) continue;
    const list = byStudent.get(row.student_id) ?? [];
    list.push(row);
    byStudent.set(row.student_id, list);
  }

  const enrolled = new Set(computed.map((r) => r.student_id));
  const deleteIds: string[] = [];
  const keep = new Map<string, ExistingPrediction>();
  for (const [studentId, rows] of byStudent) {
    const sorted = [...rows].sort(newestFirst);
    if (!enrolled.has(studentId)) {
      deleteIds.push(...sorted.map((r) => r.id));
      continue;
    }
    keep.set(studentId, sorted[0]);
    deleteIds.push(...sorted.slice(1).map((r) => r.id));
  }

  const upserts: PredictionWrite[] = [];
  let unchanged = 0;
  for (const row of computed) {
    const current = keep.get(row.student_id);
    if (!current) {
      upserts.push({ ...row, id: opts.newId(), created_at: opts.now, previous_risk_level: null, previous_attendance_rate: null });
      continue;
    }
    const changed =
      current.subject_id !== row.subject_id ||
      PREDICTION_VALUE_COLUMNS.some((col) => !sameValue(current[col], row[col]));
    if (!changed) {
      unchanged += 1;
      continue;
    }
    upserts.push({
      ...row,
      id: current.id,
      created_at: opts.now,
      previous_risk_level: (current.risk_level as string | null | undefined) ?? null,
      previous_attendance_rate:
        current.attendance_rate != null && Number.isFinite(Number(current.attendance_rate))
          ? Number(current.attendance_rate)
          : null,
    });
  }

  return { upserts, deleteIds, unchanged };
}
