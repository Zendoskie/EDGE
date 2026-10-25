/**
 * Final-grade release for release-final-grades. Pure: no Deno or network imports.
 * The grade is the Phase 1 weighted grade (./weighted-grading.ts) rounded to two decimals;
 * this module only decides completeness and what to write. Writes go through the
 * commit_final_grade_releases RPC, which rejects the batch if any grade input changed
 * after the subject's input version was read (migration 20261013130000).
 */
import {
  assessmentPercent,
  computeSubjectWeightedGrade,
  DEFAULT_SUBJECT_GRADING_WEIGHTS,
  isCourseworkType,
  isFinalExamType,
  isMidtermSideType,
  isProjectType,
  roundGrade2,
  type GradeItem,
  type GradeWeights,
} from "./weighted-grading.ts";
import { isSubjectOwner } from "./risk-scoring.ts";

export type ReleaseCategory = "activity" | "project" | "exam_midterm" | "exam_final";

export type MissingItem =
  | { kind: "category_empty"; category: ReleaseCategory }
  | {
    kind: "assessment_unscored";
    category: ReleaseCategory;
    activity_id: string;
    title: string;
    type: string;
    reason: "no_submission" | "null_score" | "invalid_max_score";
  }
  | { kind: "attendance_missing" }
  | { kind: "attendance_all_excused" };

export type ReleaseActivity = { id: string; title: string; type: string; max_score: number | string | null };
export type ReleaseSubmission = {
  student_id: string;
  activity_id: string;
  score: number | string | null;
  assessment_type: string | null;
};
export type EffectiveWeights = {
  activity_weight: number;
  project_weight: number;
  attendance_weight: number;
  exam_weight: number;
};
export type ExistingRelease = {
  student_id: string;
  final_grade: number | string | null;
  weights: Partial<EffectiveWeights> | null;
  status: string;
};
export type ReleaseWrite = { student_id: string; final_grade: number; weights: EffectiveWeights };

/** The saved row, or the Phase 1 defaults when none exists. Stored on each release so weight edits can be detected. */
export function effectiveWeights(saved: GradeWeights | null): EffectiveWeights {
  const w = saved ?? DEFAULT_SUBJECT_GRADING_WEIGHTS;
  return {
    activity_weight: Number(w.activity_weight) || 0,
    project_weight: Number(w.project_weight) || 0,
    attendance_weight: Number(w.attendance_weight) || 0,
    exam_weight: Number(w.exam_weight) || 0,
  };
}

/** Same precedence as Phase 1: the submission's assessment type, else the activity type. */
function categoryOf(type: string | null | undefined): ReleaseCategory | null {
  if (isCourseworkType(type)) return "activity";
  if (isProjectType(type)) return "project";
  if (isFinalExamType(type)) return "exam_final";
  if (isMidtermSideType(type)) return "exam_midterm";
  return null;
}

function categoryRequired(category: ReleaseCategory, w: EffectiveWeights): boolean {
  if (category === "activity") return w.activity_weight > 0;
  if (category === "project") return w.project_weight > 0;
  return w.exam_weight > 0;
}

/**
 * One student's completeness. Every assessment in a positively weighted category must be scored
 * (zero counts; blank does not), each such category needs at least one assessment (Exam needs a
 * Midterm-side and a Final), and positively weighted Attendance needs at least one non-excused row.
 */
export function evaluateGradeCompleteness(input: {
  activities: ReleaseActivity[];
  submissionsByActivity: Map<string, ReleaseSubmission>;
  attendanceStatuses: string[];
  weights: EffectiveWeights;
}): { complete: boolean; missing: MissingItem[] } {
  const missing: MissingItem[] = [];
  const seen = new Set<ReleaseCategory>();

  for (const activity of input.activities) {
    const submission = input.submissionsByActivity.get(activity.id);
    const type = submission?.assessment_type || activity.type;
    const category = categoryOf(type);
    if (!category || !categoryRequired(category, input.weights)) continue;
    seen.add(category);
    if (!submission) {
      missing.push(unscored(category, activity, type, "no_submission"));
    } else if (submission.score == null) {
      missing.push(unscored(category, activity, type, "null_score"));
    } else if (assessmentPercent(submission.score, activity.max_score) == null) {
      missing.push(unscored(category, activity, type, "invalid_max_score"));
    }
  }

  const requiredCategories: ReleaseCategory[] = [];
  if (input.weights.activity_weight > 0) requiredCategories.push("activity");
  if (input.weights.project_weight > 0) requiredCategories.push("project");
  if (input.weights.exam_weight > 0) requiredCategories.push("exam_midterm", "exam_final");
  for (const category of requiredCategories) {
    if (!seen.has(category)) missing.push({ kind: "category_empty", category });
  }

  if (input.weights.attendance_weight > 0) {
    if (input.attendanceStatuses.length === 0) missing.push({ kind: "attendance_missing" });
    else if (input.attendanceStatuses.every((s) => s === "excused")) missing.push({ kind: "attendance_all_excused" });
  }

  return { complete: missing.length === 0, missing };
}

function unscored(
  category: ReleaseCategory,
  activity: ReleaseActivity,
  type: string,
  reason: "no_submission" | "null_score" | "invalid_max_score",
): MissingItem {
  return { kind: "assessment_unscored", category, activity_id: activity.id, title: activity.title, type, reason };
}

/** The Phase 1 grade with predict-risk's attendance convention: (present + late) / rows. */
export function computeReleaseGrade(input: {
  activities: ReleaseActivity[];
  submissionsByActivity: Map<string, ReleaseSubmission>;
  attendanceStatuses: string[];
  savedWeights: GradeWeights | null;
}): number | null {
  const items: GradeItem[] = [];
  for (const activity of input.activities) {
    const submission = input.submissionsByActivity.get(activity.id);
    if (!submission || submission.score == null) continue;
    items.push({
      type: activity.type,
      assessmentType: submission.assessment_type,
      score: Number(submission.score),
      maxScore: Number(activity.max_score),
    });
  }
  const total = input.attendanceStatuses.length;
  const present = input.attendanceStatuses.filter((s) => s === "present" || s === "late").length;
  const attendancePercent = total > 0 ? (present / total) * 100 : null;
  return roundGrade2(
    computeSubjectWeightedGrade({ items, attendancePercent, weights: input.savedWeights }).weightedAverage,
  );
}

function sameWeights(a: Partial<EffectiveWeights> | null | undefined, b: EffectiveWeights): boolean {
  if (!a) return false;
  return (Object.keys(b) as Array<keyof EffectiveWeights>).every((k) => Number(a[k]) === b[k]);
}

/** New, needs_review, or changed grade or weights are written; equal released rows are skipped. */
export function planReleaseWrites(
  existing: ExistingRelease[],
  candidates: ReleaseWrite[],
): { writes: ReleaseWrite[]; unchanged: number } {
  const byStudent = new Map(existing.map((r) => [r.student_id, r]));
  const writes: ReleaseWrite[] = [];
  let unchanged = 0;
  for (const c of candidates) {
    const row = byStudent.get(c.student_id);
    const same = row && row.status === "released" && row.final_grade != null &&
      Number(row.final_grade) === c.final_grade && sameWeights(row.weights, c.weights);
    if (same) unchanged++;
    else writes.push(c);
  }
  return { writes, unchanged };
}

/* ------------------------------------------------------------ request handling */

export type ReleaseOutcome = "all_released" | "partial" | "none_released";
export type ReleaseResult = { status: number; body: Record<string, unknown> };
export type CommitResult = { committed: boolean; version: number; written: number };

/** Supabase-js subset used here; a recording fake implements it in tests. */
export type ReleaseClient = { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any };

export const MAX_STUDENT_IDS = 500;
export const PAGE_SIZE = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const STALE_MESSAGE =
  "Grades, attendance, assessments or weights changed while the release was running. Nothing was released. Recheck the gradebook and release again.";

function parseBody(body: unknown): { subjectId: string; studentIds: string[] | null } | null {
  if (!body || typeof body !== "object") return null;
  const { subject_id, student_ids } = body as { subject_id?: unknown; student_ids?: unknown };
  if (typeof subject_id !== "string" || !UUID_RE.test(subject_id)) return null;
  if (student_ids === undefined || student_ids === null) return { subjectId: subject_id, studentIds: null };
  if (!Array.isArray(student_ids) || student_ids.length > MAX_STUDENT_IDS) return null;
  if (!student_ids.every((id) => typeof id === "string" && UUID_RE.test(id))) return null;
  return { subjectId: subject_id, studentIds: [...new Set((student_ids as string[]).map((id) => id.toLowerCase()))] };
}

function one<T>(embedded: T | T[] | null | undefined): T | null {
  return Array.isArray(embedded) ? embedded[0] ?? null : embedded ?? null;
}

/**
 * Reads every row of a subject-scoped query. PostgREST caps a response at the project's max rows,
 * so pages are requested until the exact count from the first page is reached.
 */
async function fetchAll<T>(build: () => any, orderColumn: string): Promise<T[]> {
  const rows: T[] = [];
  let total: number | null = null;
  while (total === null || rows.length < total) {
    const { data, error, count } = await build()
      .order(orderColumn, { ascending: true })
      .range(rows.length, rows.length + PAGE_SIZE - 1);
    if (error) throw error;
    if (total === null) total = count ?? 0;
    const page = (data ?? []) as T[];
    if (page.length === 0) break;
    rows.push(...page);
  }
  return rows;
}

/**
 * Authorization, completeness and the version-checked commit. `userId` is the caller verified by
 * auth.getUser (null when the token is missing or invalid). The subject's input version is read in
 * the same query as its weights, before any other input, and passed to the commit RPC.
 */
export async function runRelease(db: ReleaseClient, userId: string | null, body: unknown): Promise<ReleaseResult> {
  if (!userId) return { status: 401, body: { error: "Unauthorized" } };

  const parsed = parseBody(body);
  if (!parsed) {
    return {
      status: 400,
      body: { error: `Body must be { subject_id: uuid, student_ids?: uuid[] (at most ${MAX_STUDENT_IDS}) }.` },
    };
  }
  const { subjectId, studentIds } = parsed;

  const { data: role, error: roleErr } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "instructor")
    .maybeSingle();
  if (roleErr) throw roleErr;
  if (!role) return { status: 403, body: { error: "Only instructors can release final grades." } };

  const { data: subject, error: subjectErr } = await db
    .from("subjects")
    .select(
      "instructor_id, subject_grading_systems(activity_weight, project_weight, attendance_weight, exam_weight), final_grade_input_versions(version)",
    )
    .eq("id", subjectId)
    .maybeSingle();
  if (subjectErr) throw subjectErr;
  // Service-role reads bypass RLS: ownership is enforced before any other read or write.
  if (!isSubjectOwner(subject, userId)) {
    return { status: 403, body: { error: "You can only release final grades for subjects you teach." } };
  }
  const savedWeights = one<GradeWeights>(subject.subject_grading_systems);
  const expectedVersion = Number(one<{ version: number | string }>(subject.final_grade_input_versions)?.version ?? 0);
  const weights = effectiveWeights(savedWeights);

  const [enrollments, activities, attendance, existing] = await Promise.all([
    fetchAll<{ student_id: string | null }>(
      () => db.from("enrollments").select("id, student_id", { count: "exact" }).eq("subject_id", subjectId).eq("status", "active"),
      "id",
    ),
    fetchAll<ReleaseActivity>(
      () => db.from("activities").select("id, title, type, max_score", { count: "exact" }).eq("subject_id", subjectId),
      "id",
    ),
    fetchAll<{ student_id: string | null; status: string }>(
      () => db.from("attendance").select("id, student_id, status", { count: "exact" }).eq("subject_id", subjectId),
      "id",
    ),
    fetchAll<ExistingRelease>(
      () =>
        db.from("final_grade_releases").select("student_id, final_grade, weights, status", { count: "exact" }).eq(
          "subject_id",
          subjectId,
        ),
      "student_id",
    ),
  ]);
  const activityIds = activities.map((a) => a.id);
  const submissions = activityIds.length === 0 ? [] : await fetchAll<ReleaseSubmission>(
    () =>
      db.from("submissions").select("id, student_id, activity_id, score, assessment_type", { count: "exact" }).in(
        "activity_id",
        activityIds,
      ),
    "id",
  );

  const enrolled = new Set(enrollments.map((e) => e.student_id).filter((id): id is string => !!id));
  const targets = studentIds ? studentIds.filter((id) => enrolled.has(id)) : [...enrolled];
  const notEnrolled = studentIds ? studentIds.filter((id) => !enrolled.has(id)) : [];

  const subsByStudent = new Map<string, Map<string, ReleaseSubmission>>();
  for (const s of submissions) {
    if (!s.student_id) continue;
    if (!subsByStudent.has(s.student_id)) subsByStudent.set(s.student_id, new Map());
    subsByStudent.get(s.student_id)!.set(s.activity_id, s);
  }
  const statusesByStudent = new Map<string, string[]>();
  for (const a of attendance) {
    if (!a.student_id) continue;
    if (!statusesByStudent.has(a.student_id)) statusesByStudent.set(a.student_id, []);
    statusesByStudent.get(a.student_id)!.push(a.status);
  }

  const candidates: ReleaseWrite[] = [];
  const incomplete: Array<{ student_id: string; missing: MissingItem[] }> = [];
  for (const studentId of targets) {
    const submissionsByActivity = subsByStudent.get(studentId) ?? new Map();
    const attendanceStatuses = statusesByStudent.get(studentId) ?? [];
    const { complete, missing } = evaluateGradeCompleteness({ activities, submissionsByActivity, attendanceStatuses, weights });
    const finalGrade = complete
      ? computeReleaseGrade({ activities, submissionsByActivity, attendanceStatuses, savedWeights })
      : null;
    if (complete && finalGrade != null) candidates.push({ student_id: studentId, final_grade: finalGrade, weights });
    else incomplete.push({ student_id: studentId, missing });
  }

  const plan = planReleaseWrites(existing, candidates);
  let written = 0;
  let unchanged = plan.unchanged;
  let newlyReleased: Array<{ student_id: string; final_grade: number }> = [];
  if (plan.writes.length > 0) {
    const { data, error } = await db.rpc("commit_final_grade_releases", {
      p_subject_id: subjectId,
      p_expected_version: expectedVersion,
      p_released_by: userId,
      p_rows: plan.writes,
    });
    if (error) throw error;
    const result = data as CommitResult;
    if (!result?.committed) {
      return {
        status: 409,
        body: { error: "inputs_changed", retry: true, message: STALE_MESSAGE, subject_id: subjectId },
      };
    }
    written = Number(result.written) || 0;
    unchanged += plan.writes.length - written;
    if (written > 0) {
      newlyReleased = plan.writes.map((row) => ({
        student_id: row.student_id,
        final_grade: row.final_grade,
      }));
    }
  }

  const complete = written + unchanged;
  const outcome: ReleaseOutcome = complete === 0 ? "none_released" : incomplete.length === 0 ? "all_released" : "partial";
  return {
    status: 200,
    body: {
      subject_id: subjectId,
      outcome,
      released: written,
      unchanged,
      incomplete,
      not_enrolled: notEnrolled,
      newly_released: newlyReleased,
    },
  };
}
