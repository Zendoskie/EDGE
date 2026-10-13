/**
 * Pure (no Deno / network imports) helpers that turn the signed-in student's own rows
 * into an authoritative "student record" for the AI Coach.
 *
 * - The grading math comes from ../_shared/weighted-grading.ts, which mirrors
 *   src/lib/weighted-grading.ts and src/lib/assessment-types.ts. It is locked to the
 *   official implementation by a parity test (src/lib/ai-coach-context.test.ts).
 * - Risk classification and risk score are passed through exactly as stored by the
 *   official risk analysis. Nothing here recalculates them.
 */

import {
  assessmentPercent,
  averageOf,
  computeSubjectWeightedGrade,
  DEFAULT_SUBJECT_GRADING_WEIGHTS,
  type GradeWeights,
  isCourseworkType,
  isExamType,
  isFinalExamType,
  isMidtermSideType,
  isProjectType,
  roundGrade2,
} from "../_shared/weighted-grading.ts";
import { categoryCoverage, RISK_BANDS, type RiskCategory } from "../_shared/risk-scoring.ts";

export type CanonicalRiskLevel = "critical" | "at_risk" | "stable" | "excelling";

export function canonicalRiskLevel(level: unknown): CanonicalRiskLevel {
  if (typeof level !== "string") return "stable";
  const normalized = level.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized === "critical") return "critical";
  if (normalized === "at_risk" || normalized === "at-risk" || normalized === "atrisk") return "at_risk";
  if (normalized === "excelling") return "excelling";
  return "stable";
}

export function riskStatusLabel(level: CanonicalRiskLevel): string {
  if (level === "critical") return "Crucial";
  if (level === "at_risk") return "Vulnerable";
  if (level === "excelling") return "Excelling";
  return "Stable";
}

/* ---------------------------------------------------------------- official grading (shared Edge copy) */

export * from "../_shared/weighted-grading.ts";

const ASSESSMENT_LABELS: Record<string, string> = {
  activity: "Activity",
  assignment: "Assignment",
  quiz: "Quiz",
  laboratory_exam: "Laboratory Exam",
  midterm_exam: "Midterm Exam",
  final_exam: "Final Exam",
  project: "Project",
  exam: "Exam",
};

export function assessmentTypeLabel(value: string | null | undefined): string {
  if (!value) return "Assessment";
  return ASSESSMENT_LABELS[value] ?? value.replace(/_/g, " ");
}

/* ---------------------------------------------------------------- record model */

/** A final_grade_releases row embedded in the enrollments request (RLS: the student's own rows). */
export type RawFinalGradeRelease = {
  student_id?: string | null;
  status?: string | null;
  final_grade?: number | string | null;
};
type RawEnrolledSubject = {
  code?: string | null;
  name?: string | null;
  final_grade_releases?: RawFinalGradeRelease[] | RawFinalGradeRelease | null;
};
export type RawEnrollment = {
  subject_id?: string | null;
  subjects?: RawEnrolledSubject | RawEnrolledSubject[] | null;
};

/**
 * Official release state. "unknown" means release rows were not loaded or were not exactly one
 * well-formed row; the coach then calls the grade provisional and points to My Scores.
 */
export type FinalReleaseState =
  | { kind: "final"; grade: number }
  | { kind: "under_review" }
  | { kind: "not_released" }
  | { kind: "unknown" };

export function finalReleaseFromEnrollment(e: RawEnrollment): FinalReleaseState {
  const s = Array.isArray(e.subjects) ? e.subjects[0] : e.subjects;
  const raw = s?.final_grade_releases;
  if (raw === undefined || raw === null) return { kind: "unknown" };
  const rows = Array.isArray(raw) ? raw : [raw];
  if (rows.length === 0) return { kind: "not_released" };
  if (rows.length > 1) return { kind: "unknown" };
  const row = rows[0];
  if (row?.status === "needs_review") return { kind: "under_review" };
  if (row?.status === "released" && row.final_grade != null && row.final_grade !== "") {
    const grade = Number(row.final_grade);
    if (Number.isFinite(grade) && grade >= 0 && grade <= 100) return { kind: "final", grade };
  }
  return { kind: "unknown" };
}
export type RawActivity = {
  id: string;
  subject_id: string;
  title?: string | null;
  type?: string | null;
  max_score?: number | null;
  due_date?: string | null;
};
export type RawSubmission = { activity_id: string; score?: number | null; assessment_type?: string | null };
export type RawAttendance = { subject_id: string; status?: string | null };
export type RawPrediction = {
  subject_id?: string | null;
  risk_level?: string | null;
  risk_score?: number | null;
  created_at?: string | null;
  activity_average?: number | null;
  quiz_average?: number | null;
  project_score?: number | null;
  attendance_rate?: number | null;
  laboratory_exam_average?: number | null;
  midterm_exam_average?: number | null;
  final_exam_average?: number | null;
};

const PREDICTION_EVIDENCE_KEYS = [
  "activity_average",
  "quiz_average",
  "project_score",
  "attendance_rate",
  "laboratory_exam_average",
  "midterm_exam_average",
  "final_exam_average",
] as const;
const RISK_CATEGORY_NAMES: Record<RiskCategory, string> = {
  activity: "Activities",
  project: "Project",
  attendance: "Attendance",
  exam: "Exams",
};

/**
 * Same convention as the dashboards: no score means "Insufficient data"; a weighted category without
 * evidence qualifies the stored label as provisional. Coverage comes from the stored prediction columns.
 * Without them, live category evidence may only mark the label provisional: it postdates the stored
 * analysis, so it never confirms it.
 */
export function riskDisplayLabel(
  level: CanonicalRiskLevel,
  pred: RawPrediction,
  weights: GradeWeights | null,
  liveEvidence: Record<RiskCategory, boolean>,
): string {
  const label = riskStatusLabel(level);
  if (pred.risk_score == null || !Number.isFinite(Number(pred.risk_score))) return "Insufficient data";
  const has = (v: unknown) => v != null && Number.isFinite(Number(v));
  const stored = PREDICTION_EVIDENCE_KEYS.every((k) => k in pred);
  const evidence = stored
    ? {
        activity: has(pred.activity_average) || has(pred.quiz_average),
        project: has(pred.project_score),
        attendance: has(pred.attendance_rate),
        exam: has(pred.laboratory_exam_average) || has(pred.midterm_exam_average) || has(pred.final_exam_average),
      }
    : liveEvidence;
  const coverage = categoryCoverage(weights, evidence);
  if (coverage.complete) return stored ? label : `${label} — Risk status unverified`;
  const missing = coverage.missing.map((c) => RISK_CATEGORY_NAMES[c]).join(", ");
  return `${label} — Provisional (incomplete data: no evidence yet for ${missing})`;
}
export type RawEngagement = {
  engagementLevel: string;
  engagementScore: number | null;
  totalLoginCount: number;
  participationCount: number;
  recentActivities: string[];
};

export type StudentRecordInput = {
  enrollments: RawEnrollment[];
  activities: RawActivity[];
  submissions: RawSubmission[];
  attendance: RawAttendance[];
  gradingSystems: Array<GradeWeights & { subject_id: string }>;
  predictions: RawPrediction[] | null;
  engagement: RawEngagement | null;
};

export type AssessmentRecord = {
  id: string;
  title: string;
  type: string | null;
  typeLabel: string;
  maxScore: number | null;
  score: number | null;
  percent: number | null;
  dueDate: string | null;
};

export type SubjectRecord = {
  subjectId: string;
  code: string;
  name: string;
  assessments: AssessmentRecord[];
  gradedCount: number;
  /** Mean of all graded assessment percentages (the "Activity Avg" badge on My Scores). */
  overallGradedAveragePercent: number | null;
  courseworkAverage: number | null;
  projectAverage: number | null;
  examAverage: number | null;
  attendance: { total: number; present: number; late: number; absent: number; other: number; percent: number | null };
  gradingWeights: { activity: number; project: number; attendance: number; exam: number };
  /** True when the subject has no saved grading row and the default weights apply. */
  usesDefaultWeights: boolean;
  /** Provisional weighted grade (computeSubjectWeightedGrade); never the official final grade. Null when it cannot be computed. */
  provisionalGrade: number | null;
  /** Official released final grade state, from final_grade_releases. */
  finalRelease: FinalReleaseState;
  risk: { classification: CanonicalRiskLevel; label: string; score: number | null; recordedAt: string | null } | null;
};

export type StudentRecord = {
  subjects: SubjectRecord[];
  engagement: RawEngagement | null;
  riskAvailable: boolean;
};

function firstSubjectMeta(e: RawEnrollment): { code: string; name: string } {
  const s = Array.isArray(e.subjects) ? e.subjects[0] : e.subjects;
  return { code: (s?.code ?? "").trim() || "Subject", name: (s?.name ?? "").trim() };
}

function dueTs(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY;
}

export function buildStudentRecord(input: StudentRecordInput): StudentRecord {
  const subjectsMeta = new Map<string, { code: string; name: string; finalRelease: FinalReleaseState }>();
  for (const e of input.enrollments) {
    if (!e.subject_id || subjectsMeta.has(e.subject_id)) continue;
    subjectsMeta.set(e.subject_id, { ...firstSubjectMeta(e), finalRelease: finalReleaseFromEnrollment(e) });
  }

  const submissionByActivity = new Map<string, RawSubmission>();
  for (const s of input.submissions) {
    if (!submissionByActivity.has(s.activity_id)) submissionByActivity.set(s.activity_id, s);
  }

  const latestPrediction = new Map<string, RawPrediction>();
  const sortedPredictions = [...(input.predictions ?? [])].sort(
    (a, b) => Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? "") || 0,
  );
  for (const p of sortedPredictions) {
    if (p.subject_id && !latestPrediction.has(p.subject_id)) latestPrediction.set(p.subject_id, p);
  }

  const subjects: SubjectRecord[] = [];
  for (const [subjectId, meta] of subjectsMeta) {
    const acts = input.activities
      .filter((a) => a.subject_id === subjectId)
      .sort((a, b) => dueTs(a.due_date) - dueTs(b.due_date));

    const assessments = acts.map((a) => {
      const sub = submissionByActivity.get(a.id);
      const score = sub?.score != null && Number.isFinite(Number(sub.score)) ? Number(sub.score) : null;
      const maxScore = a.max_score != null && Number.isFinite(Number(a.max_score)) ? Number(a.max_score) : null;
      const rawPct = score != null && maxScore != null ? Math.round((score / maxScore) * 100) : null;
      const type = sub?.assessment_type || a.type || null;
      return {
        id: a.id,
        title: (a.title ?? "").trim() || "Untitled",
        type,
        typeLabel: assessmentTypeLabel(type),
        maxScore,
        score,
        percent: rawPct != null && Number.isFinite(rawPct) ? rawPct : null,
        dueDate: a.due_date ?? null,
      } satisfies AssessmentRecord;
    });

    const gradedPercents = assessments.map((a) => a.percent);
    const gradedCount = assessments.filter((a) => a.percent != null).length;
    const overall = averageOf(gradedPercents);

    const att = input.attendance.filter((r) => r.subject_id === subjectId);
    const present = att.filter((r) => r.status === "present").length;
    const late = att.filter((r) => r.status === "late").length;
    const absent = att.filter((r) => r.status === "absent").length;
    const attendancePercent = att.length ? ((present + late) / att.length) * 100 : null;

    const savedWeights = input.gradingSystems.find((g) => g.subject_id === subjectId) ?? null;
    const weights = savedWeights ?? DEFAULT_SUBJECT_GRADING_WEIGHTS;
    const {
      activityAverage: courseworkAverage,
      projectAverage,
      examAverage,
      weightedAverage: provisionalGrade,
    } = computeSubjectWeightedGrade({
      items: assessments.map((a) => ({ type: a.type, score: a.score, maxScore: a.maxScore })),
      attendancePercent,
      weights,
    });

    const pred = latestPrediction.get(subjectId);
    const hasRisk = !!pred && typeof pred.risk_level === "string" && pred.risk_level.trim() !== "";
    const classification = hasRisk ? canonicalRiskLevel(pred!.risk_level) : null;

    subjects.push({
      subjectId,
      code: meta.code,
      name: meta.name,
      assessments,
      gradedCount,
      overallGradedAveragePercent: overall != null ? Math.round(overall) : null,
      courseworkAverage,
      projectAverage,
      examAverage,
      attendance: {
        total: att.length,
        present,
        late,
        absent,
        other: att.length - present - late - absent,
        percent: attendancePercent != null ? Math.round(attendancePercent * 10) / 10 : null,
      },
      gradingWeights: {
        activity: Number(weights.activity_weight) || 0,
        project: Number(weights.project_weight) || 0,
        attendance: Number(weights.attendance_weight) || 0,
        exam: Number(weights.exam_weight) || 0,
      },
      usesDefaultWeights: savedWeights == null,
      provisionalGrade,
      finalRelease: meta.finalRelease,
      risk: classification
        ? {
            classification,
            label: riskDisplayLabel(classification, pred!, savedWeights, {
              activity: courseworkAverage != null,
              project: projectAverage != null,
              attendance: attendancePercent != null,
              exam: examAverage != null,
            }),
            score:
              pred!.risk_score != null && Number.isFinite(Number(pred!.risk_score))
                ? roundGrade2(Number(pred!.risk_score))
                : null,
            recordedAt: pred!.created_at ?? null,
          }
        : null,
    });
  }

  return { subjects, engagement: input.engagement, riskAvailable: input.predictions != null };
}

/* ---------------------------------------------------------------- subject / assessment lookup */

function codePattern(code: string): RegExp | null {
  const compact = code.replace(/[\s-]+/g, "");
  if (compact.length < 2) return null;
  const runs = compact.match(/[A-Za-z]+|\d+/g);
  if (!runs) return null;
  const body = runs.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s-]*");
  return new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, "i");
}

export function findMentionedSubjects(record: StudentRecord, text: string): SubjectRecord[] {
  const lower = text.toLowerCase();
  const hits: Array<{ subject: SubjectRecord; index: number }> = [];
  for (const s of record.subjects) {
    const re = codePattern(s.code);
    const m = re ? re.exec(text) : null;
    if (m) {
      hits.push({ subject: s, index: m.index });
      continue;
    }
    const name = s.name.toLowerCase();
    if (name.length >= 4) {
      const idx = lower.indexOf(name);
      if (idx >= 0) hits.push({ subject: s, index: idx });
    }
  }
  return hits.sort((a, b) => a.index - b.index).map((h) => h.subject);
}

const NON_CODE_WORDS = new Set([
  "quiz", "activity", "exam", "project", "assignment", "week", "day", "hours", "hour", "grade", "page", "chapter",
  "lab", "level", "unit", "module", "item", "number", "mid", "final", "test", "part", "lesson", "topic",
]);

/** A course-code-looking token (e.g. XY999) that is not one of the student's active subjects. */
export function findUnknownSubjectCode(record: StudentRecord, text: string): string | null {
  const re = /(?<![A-Za-z0-9])([A-Za-z]{2,6})-?(\d{3})([A-Za-z]?)(?![A-Za-z0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (NON_CODE_WORDS.has(m[1].toLowerCase())) continue;
    const token = m[0];
    const known = record.subjects.some((s) => {
      const p = codePattern(s.code);
      return p ? p.test(token) : false;
    });
    if (!known) return token.toUpperCase();
  }
  return null;
}

export function resolveFocusSubject(
  record: StudentRecord,
  messages: Array<{ role: string; content: string }>,
): SubjectRecord | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const hit = findMentionedSubjects(record, messages[i].content)[0];
    if (hit) return hit;
  }
  return record.subjects.length === 1 ? record.subjects[0] : null;
}

export type AssessmentReference = { key: string; number: number | null; label: string };

const TYPE_PATTERNS: Array<{ key: string; re: RegExp }> = [
  { key: "laboratory_exam", re: /\b(?:lab(?:oratory)?\s*exam(?:ination)?s?|laboratory)\b/i },
  { key: "midterm_exam", re: /\bmid[\s-]?terms?(?:\s*exam(?:ination)?s?)?\b/i },
  { key: "final_exam", re: /\bfinals?(?:\s*exam(?:ination)?s?)?\b/i },
  { key: "quiz", re: /\bquiz(?:zes)?\b/i },
  { key: "activity", re: /\bactivit(?:y|ies)\b/i },
  { key: "assignment", re: /\bassignments?\b/i },
  { key: "project", re: /\bprojects?\b/i },
  { key: "exam", re: /\bexams?\b|\bexamination\b/i },
];

export function parseAssessmentReference(text: string): AssessmentReference | null {
  for (const { key, re } of TYPE_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const after = text.slice(m.index + m[0].length);
    const num = /^\s*(?:no\.?|number|#)?\s*(\d{1,3})(?!\d)/i.exec(after);
    const number = num ? Number(num[1]) : null;
    return {
      key,
      number,
      label: `${assessmentTypeLabel(key)}${number != null ? ` ${number}` : ""}`,
    };
  }
  return null;
}

function titleNumbers(title: string): number[] {
  return (title.match(/\d+/g) ?? []).map(Number);
}

export function findAssessments(subject: SubjectRecord, ref: AssessmentReference): AssessmentRecord[] {
  const typeRe = TYPE_PATTERNS.find((p) => p.key === ref.key)?.re;
  const candidates = subject.assessments.filter((a) => {
    if (a.type === ref.key) return true;
    if (ref.key === "exam" && isExamType(a.type)) return true;
    return typeRe ? typeRe.test(a.title) : false;
  });
  if (ref.number == null) return candidates;
  return candidates.filter((a) => titleNumbers(a.title).includes(ref.number as number));
}

/* ---------------------------------------------------------------- intents & guards */

const ADVICE_WORDS =
  /\b(improv\w*|study|studying|tips?|advice|how (?:can|do|should|to|could)|prepare|review|plan|strateg\w*|weak\w*|help|focus|boost|raise)\b/i;
const SCORE_WORDS =
  /\b(score|scored|grade|graded|result|results|mark|marks|points?|got|get|received|rating)\b|what(?:'s|\u2019s| is| was)|how (?:did|much)/i;
const GRADE_WORDS = /\b(grade|grades|gpa|standing|average|percentage)\b/i;
const GRADE_ASK_WORDS = /\b(what|current|my|show|tell|check|how much|overall)\b/i;

export type DirectIntent = "score_lookup" | "grade_lookup" | null;

export function detectDirectIntent(text: string): DirectIntent {
  if (ADVICE_WORDS.test(text)) return null;
  const ref = parseAssessmentReference(text);
  if (ref && (SCORE_WORDS.test(text) || /^\s*(?:and\s+|what about|how about)/i.test(text))) return "score_lookup";
  if (!ref && GRADE_WORDS.test(text) && GRADE_ASK_WORDS.test(text) && !/how am i (?:doing|performing)/i.test(text)) {
    return "grade_lookup";
  }
  return null;
}

const DATA_WORDS =
  "(?:grades?|scores?|results?|marks?|attendance|risk|performance|records?|data|information|info|gpa|quiz(?:zes)?|exams?|standing|status|average)";
const OTHER_PEOPLE =
  /\b(classmates?|class\s?mates?|batch\s?mates?|seat\s?mates?|friends?|brother|sister|roommates?|another student|other students?|another person|someone else|somebody else|everyone|everybody|all students|whole class|entire class|the class|top (?:student|scorer|performer)s?|valedictorian|rankings?)\b/i;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const STUDENT_ID = /(?<!\bmy\s)\bstudent\s*(?:id|number|no\.?|#)\s*[:#]?\s*[A-Za-z0-9-]{3,}/i;
const POSSESSIVE_NAME = new RegExp(
  `\\b([A-Za-z][A-Za-z.-]{1,})['\\u2019]s\\s+(?:[\\w-]+\\s+){0,2}?${DATA_WORDS}\\b`,
  "i",
);
const PRONOUN_DATA = new RegExp(`\\b(?:his|her|hers|their|theirs)\\s+(?:[\\w-]+\\s+){0,2}?${DATA_WORDS}\\b`, "i");
const NOT_A_NAME = new Set(["what", "it", "that", "there", "here", "who", "how", "where", "when", "let", "this", "today", "everyone"]);

/**
 * Convenience guard only. The actual protection is that the data loader runs as the
 * signed-in user under RLS, so another student's rows are never in the AI context.
 */
export function isOtherStudentRequest(text: string): boolean {
  if (UUID.test(text) || STUDENT_ID.test(text)) return true;
  if (PRONOUN_DATA.test(text)) return true;
  const poss = POSSESSIVE_NAME.exec(text);
  if (poss && !NOT_A_NAME.has(poss[1].toLowerCase())) return true;
  if (OTHER_PEOPLE.test(text) && new RegExp(`\\b${DATA_WORDS}\\b`, "i").test(text)) return true;
  return false;
}

const SCOPE_KEYWORDS = [
  "academic", "study", "subject", "course", "class", "teacher", "instructor", "attendance", "absent", "late", "grade",
  "score", "quiz", "exam", "assignment", "project", "submission", "risk", "prediction", "recommendation",
  "performance", "perform", "improve", "school", "college", "university", "gpa", "pass", "fail", "semester", "review",
  "hour", "night", "week", "plan", "goal", "weak", "strong", "help", "learn", "tips", "motivat", "progress", "focus",
  "schedule", "revise", "practice", "topic", "activity", "lesson", "homework", "deadline", "engagement",
];

export function isCoachingInScope(
  text: string,
  opts: { hasPriorUserTurn: boolean; mentionsSubject: boolean },
): boolean {
  const lower = text.toLowerCase();
  if (!lower.trim()) return true;
  if (opts.hasPriorUserTurn || opts.mentionsSubject) return true;
  if (/^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(lower)) return true;
  if (parseAssessmentReference(text)) return true;
  return SCOPE_KEYWORDS.some((k) => lower.includes(k));
}

const HOURS_RE =
  /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?)\s*(?:every|each|per|a|\/)\s*(night|evening|day|weekday|weekend|week)/i;
const HOURS_RE_ALT =
  /(?:every|each)\s*(night|evening|day|weekday)\s*(?:for\s*)?(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)/i;

function toHours(amount: number, unit: string): number {
  return /^m/i.test(unit) ? amount / 60 : amount;
}

const trimNum = (n: number) => String(Math.round(n * 10) / 10);

export function parseStudyAvailability(texts: string[]): string | null {
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i];
    let amount: number | null = null;
    let unit = "";
    let per = "";
    const a = HOURS_RE.exec(t);
    if (a) {
      amount = Number(a[1]);
      unit = a[2];
      per = a[3].toLowerCase();
    } else {
      const b = HOURS_RE_ALT.exec(t);
      if (b) {
        amount = Number(b[2]);
        unit = b[3];
        per = b[1].toLowerCase();
      }
    }
    if (amount == null || !Number.isFinite(amount) || amount <= 0) continue;
    const hours = toHours(amount, unit);
    const perDays: Record<string, number> = { night: 7, evening: 7, day: 7, weekday: 5, weekend: 2, week: 1 };
    const days = perDays[per] ?? 1;
    const weekly = per === "week" ? hours : hours * days;
    const perLabel = per === "week" ? "week" : per;
    return `${trimNum(hours)} hour(s) per ${perLabel}${per === "week" ? "" : ` (about ${trimNum(weekly)} hours per week if kept every ${perLabel})`}`;
  }
  return null;
}

/* ---------------------------------------------------------------- deterministic answers */

const fmtPct = (n: number | null) => (n == null ? "n/a" : `${Math.round(n)}%`);
/** Same two-decimal value that predict-risk stores and classifies. */
const fmtGrade = (n: number) => `${roundGrade2(n)!.toFixed(2)}%`;

function subjectTitle(s: SubjectRecord): string {
  return s.name ? `${s.code} (${s.name})` : s.code;
}

function assessmentValue(a: AssessmentRecord, now: Date): string {
  if (a.score != null && a.maxScore != null && a.percent != null) return `${a.score} out of ${a.maxScore} (${a.percent}%)`;
  if (a.score != null) return `${a.score}${a.maxScore != null ? ` out of ${a.maxScore}` : ""}`;
  const overdue = a.dueDate && Date.parse(a.dueDate) < now.getTime();
  return overdue ? "no score recorded yet (the due date has passed)" : "not graded yet";
}

export function answerScoreLookup(
  record: StudentRecord,
  text: string,
  focus: SubjectRecord | null,
  now: Date,
): string | null {
  const ref = parseAssessmentReference(text);
  if (!ref) return null;
  const mentioned = findMentionedSubjects(record, text);
  if (mentioned.length === 0) {
    const unknown = findUnknownSubjectCode(record, text);
    if (unknown) {
      const mine = record.subjects.map((s) => s.code).join(", ");
      return `I can't find ${unknown} among your active subjects${mine ? ` (${mine})` : ""}, so I have no scores for it.`;
    }
  }
  const scope = mentioned.length > 0 ? mentioned : focus ? [focus] : record.subjects;

  const found = scope
    .map((s) => ({ subject: s, matches: findAssessments(s, ref) }))
    .filter((x) => x.matches.length > 0);

  if (found.length === 0) {
    const where = scope.length === 1 ? subjectTitle(scope[0]) : "your subjects";
    const listed =
      scope.length === 1 && scope[0].assessments.length > 0
        ? ` Assessments on record for ${scope[0].code}: ${scope[0].assessments
            .slice(0, 15)
            .map((a) => a.title)
            .join(", ")}.`
        : "";
    return `I couldn't find ${ref.label} in ${where}, so I don't have a score for it.${listed}`;
  }

  const lines = found.flatMap(({ subject, matches }) =>
    matches.map((a) =>
      found.length > 1 || matches.length > 1
        ? `${subject.code} - ${a.title}: ${assessmentValue(a, now)}`
        : `In ${subjectTitle(subject)}, your ${a.title} result is ${assessmentValue(a, now)}.`,
    ),
  );
  if (lines.length === 1) return lines[0];
  const header =
    found.length > 1
      ? `${ref.label} appears in more than one subject. Here is what is on record:`
      : `Here is what is on record for ${ref.label} in ${subjectTitle(found[0].subject)}:`;
  return [header, ...lines].join("\n");
}

function provisionalSentence(s: SubjectRecord): string {
  if (s.provisionalGrade == null) {
    return "A provisional weighted grade isn't available yet because there is no graded work or attendance to calculate it from.";
  }
  const w = s.gradingWeights;
  const parts = [
    `Coursework ${fmtPct(s.courseworkAverage)} (weight ${w.activity})`,
    `Projects ${fmtPct(s.projectAverage)} (weight ${w.project})`,
    `Attendance ${fmtPct(s.attendance.percent)} (weight ${w.attendance})`,
    `Exams ${fmtPct(s.examAverage)} (weight ${w.exam})`,
  ];
  const source = s.usesDefaultWeights
    ? "the default grading weights, because your instructor has not customized them"
    : "your subject's grading system";
  return `Your provisional weighted grade is ${fmtGrade(s.provisionalGrade)}, calculated from ${source}. It is not your official final grade. Categories with no data yet are left out. ${parts.join("; ")}.`;
}

function gradeLine(s: SubjectRecord): string {
  const title = subjectTitle(s);
  const fr = s.finalRelease;
  if (fr.kind === "final") {
    return `${title}: your official final grade is ${fmtGrade(fr.grade)}, released by your instructor.`;
  }
  if (fr.kind === "under_review") {
    return `${title}: your final grade is under review because grades, attendance, assessments or weights changed after it was released. ${provisionalSentence(s)}`;
  }
  if (fr.kind === "not_released") {
    return `${title}: your instructor has not released a final grade yet. ${provisionalSentence(s)}`;
  }
  return `${title}: ${provisionalSentence(s)} Check My Scores for your official Final or Under review status.`;
}

function finalGradePromptLine(fr: FinalReleaseState): string {
  if (fr.kind === "final") return `Official final grade: ${fmtGrade(fr.grade)} (released by the instructor)`;
  if (fr.kind === "under_review") {
    return "Official final grade: UNDER REVIEW (grading inputs changed after release; do not state any earlier final grade)";
  }
  if (fr.kind === "not_released") return "Official final grade: NOT RELEASED (the instructor has not released a final grade)";
  return "Official final grade: UNKNOWN (tell the student to check My Scores for their Final or Under review status)";
}

export function answerGradeLookup(record: StudentRecord, text: string, focus: SubjectRecord | null): string {
  const mentioned = findMentionedSubjects(record, text);
  if (mentioned.length === 0) {
    const unknown = findUnknownSubjectCode(record, text);
    if (unknown) {
      const mine = record.subjects.map((s) => s.code).join(", ");
      return `I can't find ${unknown} among your active subjects${mine ? ` (${mine})` : ""}, so I have no grade for it.`;
    }
  }
  const scope = mentioned.length > 0 ? mentioned : focus ? [focus] : record.subjects;
  return scope.map(gradeLine).join("\n");
}

/* ---------------------------------------------------------------- prompt context */

/** Coaching benchmark: the official Crucial boundary. A coaching reference only; it never reclassifies risk. */
export const WEAK_AREA_BENCHMARK: number = RISK_BANDS.at_risk;

export type WeakComponentKey = "activity" | "project" | "midterm" | "final" | "attendance";

export type EvidenceSource = {
  title: string;
  typeLabel: string;
  score: number | null;
  maxScore: number | null;
  /** Unrounded percentage; null when the score is missing or the max score is invalid. Zero is a score. */
  percent: number | null;
  /** Share of the current provisional grade carried by this one assessment; null when unscored. */
  effectiveWeight: number | null;
  dueDate: string | null;
  pastDue: boolean;
};

export type ComponentEvidence = {
  key: WeakComponentKey;
  label: string;
  /** Category weight as configured (Midterm and Final show the Exam weight). */
  configuredWeight: number;
  percent: number | null;
  /** Share of the current provisional grade, after the official renormalization and Exam split. Null when not established. */
  effectiveWeight: number | null;
  /** Points below the benchmark (0 when at or above); null without a percentage. */
  gap: number | null;
  /** effectiveWeight x gap / 100; null when either is unknown. */
  priority: number | null;
  scored: EvidenceSource[];
  unscored: EvidenceSource[];
};

export type RankedAssessment = EvidenceSource & { component: string; gap: number; priority: number };

export type WeakAreaAnalysis = {
  benchmark: number;
  /** All five components in a fixed order: Activity, Project, Midterm Exam, Final Exam, Attendance. */
  components: ComponentEvidence[];
  /** Components below the benchmark that carry grade weight, highest priority first. */
  ranked: ComponentEvidence[];
  /** Scored assessments below the benchmark that carry grade weight, highest priority first. */
  belowBenchmarkAssessments: RankedAssessment[];
  /** Assessments whose type maps to no grading category. The official grade excludes them too. */
  unmapped: EvidenceSource[];
};

const byPriority = <T extends { priority: number | null; gap: number | null }>(a: T, b: T) =>
  (b.priority ?? 0) - (a.priority ?? 0) || (b.gap ?? 0) - (a.gap ?? 0);

/**
 * Deterministic weak-area analysis from the student's own record, using the official grading
 * rules: categories without data are left out and the rest renormalized; assessments split their
 * category weight equally; Midterm carries the full Exam weight until a Final score exists.
 */
export function analyzeWeakAreas(s: SubjectRecord, now: Date): WeakAreaAnalysis {
  const B = WEAK_AREA_BENCHMARK;
  const groups: Record<Exclude<WeakComponentKey, "attendance">, AssessmentRecord[]> = {
    activity: [],
    project: [],
    midterm: [],
    final: [],
  };
  const unmapped: AssessmentRecord[] = [];
  for (const a of s.assessments) {
    if (isCourseworkType(a.type)) groups.activity.push(a);
    else if (isProjectType(a.type)) groups.project.push(a);
    else if (isFinalExamType(a.type)) groups.final.push(a);
    else if (isMidtermSideType(a.type)) groups.midterm.push(a);
    else unmapped.push(a);
  }

  const toSource = (a: AssessmentRecord): EvidenceSource => ({
    title: a.title,
    typeLabel: a.typeLabel,
    score: a.score,
    maxScore: a.maxScore,
    percent: assessmentPercent(a.score, a.maxScore),
    effectiveWeight: null,
    dueDate: a.dueDate,
    pastDue: a.score == null && !!a.dueDate && Date.parse(a.dueDate) < now.getTime(),
  });
  const split = (items: AssessmentRecord[]) => {
    const all = items.map(toSource);
    const scored = all.filter((x) => x.percent != null);
    return { scored, unscored: all.filter((x) => x.percent == null), percent: averageOf(scored.map((x) => x.percent)) };
  };
  const parts = {
    activity: split(groups.activity),
    project: split(groups.project),
    midterm: split(groups.midterm),
    final: split(groups.final),
  };
  const att = s.attendance;
  const attendancePercent = att.total > 0 ? ((att.present + att.late) / att.total) * 100 : null;

  const w = s.gradingWeights;
  const examPercent = averageOf([parts.midterm.percent, parts.final.percent]);
  const categories = [
    { weight: w.activity, present: parts.activity.percent != null },
    { weight: w.project, present: parts.project.percent != null },
    { weight: w.attendance, present: attendancePercent != null },
    { weight: w.exam, present: examPercent != null },
  ];
  const total = categories.filter((c) => c.present && c.weight > 0).reduce((sum, c) => sum + c.weight, 0);
  const share = (weight: number, present: boolean) => (present && weight > 0 && total > 0 ? (weight / total) * 100 : null);
  const examShare = share(w.exam, examPercent != null);
  const bothExamSides = parts.midterm.percent != null && parts.final.percent != null;
  const sideShare = (present: boolean) => (examShare != null && present ? (bothExamSides ? examShare / 2 : examShare) : null);

  const build = (
    key: WeakComponentKey,
    label: string,
    configuredWeight: number,
    percent: number | null,
    effectiveWeight: number | null,
    scored: EvidenceSource[] = [],
    unscored: EvidenceSource[] = [],
  ): ComponentEvidence => {
    const gap = percent != null ? Math.max(0, B - percent) : null;
    for (const x of scored) x.effectiveWeight = effectiveWeight != null ? effectiveWeight / scored.length : null;
    return {
      key,
      label,
      configuredWeight,
      percent,
      effectiveWeight,
      gap,
      priority: effectiveWeight != null && gap != null ? (effectiveWeight * gap) / 100 : null,
      scored,
      unscored,
    };
  };

  const components = [
    build("activity", "Activity", w.activity, parts.activity.percent, share(w.activity, parts.activity.percent != null), parts.activity.scored, parts.activity.unscored),
    build("project", "Project", w.project, parts.project.percent, share(w.project, parts.project.percent != null), parts.project.scored, parts.project.unscored),
    build("midterm", "Midterm Exam", w.exam, parts.midterm.percent, sideShare(parts.midterm.percent != null), parts.midterm.scored, parts.midterm.unscored),
    build("final", "Final Exam", w.exam, parts.final.percent, sideShare(parts.final.percent != null), parts.final.scored, parts.final.unscored),
    build("attendance", "Attendance", w.attendance, attendancePercent, share(w.attendance, attendancePercent != null)),
  ];

  const ranked = components.filter((c) => (c.priority ?? 0) > 0).sort(byPriority);
  const belowBenchmarkAssessments = components
    .flatMap((c) =>
      c.scored
        .filter((x) => x.percent! < B && (x.effectiveWeight ?? 0) > 0)
        .map((x) => {
          const gap = B - x.percent!;
          return { ...x, component: c.label, gap, priority: (x.effectiveWeight! * gap) / 100 };
        }),
    )
    .sort(byPriority);

  return { benchmark: B, components, ranked, belowBenchmarkAssessments, unmapped: unmapped.map(toSource) };
}

const f2 = (n: number) => n.toFixed(2);

function sourceValue(x: EvidenceSource): string {
  if (x.score == null) return x.pastDue ? "NO SCORE RECORDED (past due)" : "not graded yet";
  const base = `${x.score}/${x.maxScore ?? "?"}`;
  return x.percent != null ? `${base} (${f2(x.percent)}%)` : `${base} (percentage not calculable: invalid max score)`;
}

function examRecordLine(c: ComponentEvidence, other: ComponentEvidence): string {
  const all = [...c.scored, ...c.unscored];
  const items = all.length
    ? ` Assessments: ${all
        .map((x) => `${x.title} ${sourceValue(x)}${x.effectiveWeight != null ? `, weight ${f2(x.effectiveWeight)}%` : ""}${x.dueDate ? `, due ${isoDay(x.dueDate)}` : ""}`)
        .join("; ")}.`
    : "";
  if (c.percent == null) {
    const status = all.length === 0 ? "NOT RECORDED" : all.some((x) => x.pastDue) ? "MISSING" : "PENDING";
    const pending =
      c.key === "final"
        ? " It is not a zero. Until a Final Exam score exists, the Midterm carries the full Exam weight; once it is scored, Midterm and Final split the Exam weight equally."
        : " It is not a zero and carries no weight until scored.";
    return `- ${c.label}: ${status}, no score recorded.${pending}${items}`;
  }
  const status = c.unscored.length ? `PARTIALLY SCORED (${c.scored.length} of ${all.length})` : "SCORED";
  const weight =
    c.effectiveWeight == null
      ? "carries no grade weight because the exam weight is 0"
      : `effective weight ${f2(c.effectiveWeight)}% of the provisional grade; ${
          other.percent != null ? "half of the Exam weight because both Midterm and Final are scored" : `the full Exam weight because no ${other.label} score is recorded`
        }`;
  return `- ${c.label}: ${status}, ${f2(c.percent)}% (${weight}).${items}`;
}

function formatWeakAreaBlock(a: WeakAreaAnalysis, isFocus: boolean): string[] {
  const B = a.benchmark;
  const [, , midterm, final] = a.components;
  const lines = ["Exam records (Midterm and Final are separate):", examRecordLine(midterm, final), examRecordLine(final, midterm)];

  lines.push(
    `Weak-area priority (benchmark ${B}%, the Crucial boundary; priority = effective weight x points below ${B} / 100; address in this order):`,
  );
  if (a.ranked.length === 0) lines.push(`- none: no weighted component is below ${B}%`);
  a.ranked.forEach((c, i) => {
    const below = c.scored.filter((x) => x.percent! < B).map((x) => `${x.title} ${sourceValue(x)}`);
    const n = c.scored.length + c.unscored.length;
    const basis = c.key === "attendance" ? "attendance rate" : `from ${c.scored.length} scored of ${n}`;
    lines.push(
      `${i + 1}. ${c.label}: ${f2(c.percent!)}% ${basis} (effective weight ${f2(c.effectiveWeight!)}% of the provisional grade; ${f2(c.gap!)} points below ${B}%; priority ${f2(c.priority!)})${below.length ? `. Low sources: ${below.join("; ")}` : ""}`,
    );
  });

  lines.push("Below-benchmark assessments (highest priority first):");
  const limit = isFocus ? 8 : 4;
  if (a.belowBenchmarkAssessments.length === 0) lines.push(`- none below ${B}%`);
  for (const x of a.belowBenchmarkAssessments.slice(0, limit)) {
    lines.push(
      `- ${x.title} [${x.typeLabel === x.component ? x.typeLabel : `${x.typeLabel}, ${x.component}`}]: ${sourceValue(x)}; effective weight ${f2(x.effectiveWeight!)}%; ${f2(x.gap)} points below ${B}%; priority ${f2(x.priority)}`,
    );
  }
  if (a.belowBenchmarkAssessments.length > limit) lines.push(`- (${a.belowBenchmarkAssessments.length - limit} more not shown)`);

  const incomplete = incompleteEvidence(a);
  lines.push("Incomplete or missing evidence (NOT low scores; never treat as zero):");
  if (incomplete.length === 0) lines.push("- none");
  for (const t of incomplete.slice(0, 10)) lines.push(`- ${t}`);

  if (a.unmapped.length > 0) {
    lines.push("Unmapped assessments (type matches no grading category; excluded from the provisional grade, weights and weak-area priority; not weaknesses):");
    for (const x of a.unmapped.slice(0, 10)) lines.push(`- ${x.title} [${x.typeLabel}]: ${sourceValue(x)}`);
  }

  const fine = a.components.filter((c) => c.percent != null && c.percent >= B && c.effectiveWeight != null);
  lines.push(`At or above ${B}%: ${fine.length ? fine.map((c) => `${c.label} ${f2(c.percent!)}%`).join(", ") : "none"}`);
  return lines;
}

/** Missing or uncalculable evidence. These are never low scores and never zero. */
function incompleteEvidence(a: WeakAreaAnalysis): string[] {
  const incomplete: string[] = [];
  for (const c of a.components) {
    if (c.key === "attendance") {
      if (c.percent == null && c.configuredWeight > 0) incomplete.push(`Attendance: no attendance recorded (configured weight ${c.configuredWeight})`);
      continue;
    }
    if (c.key === "midterm" || c.key === "final") {
      for (const x of c.unscored) if (x.pastDue) incomplete.push(`${x.title} [${x.typeLabel}]: no score recorded and its due date has passed`);
      continue;
    }
    if (c.configuredWeight <= 0) continue;
    if (c.scored.length + c.unscored.length === 0) incomplete.push(`${c.label}: no assessments recorded yet (configured weight ${c.configuredWeight})`);
    else if (c.scored.length === 0) incomplete.push(`${c.label}: no scores recorded yet (${c.unscored.length} assessment(s) without a score)`);
    for (const x of c.unscored) {
      if (x.pastDue) incomplete.push(`${x.title} [${x.typeLabel}]: no score recorded and its due date has passed`);
      else if (x.score != null) incomplete.push(`${x.title} [${x.typeLabel}]: score recorded but the percentage cannot be calculated`);
    }
  }
  return incomplete;
}

/* ---------------------------------------------------------------- AI-down fallback */

const FALLBACK_ACTIONS: Record<WeakComponentKey, string> = {
  activity: "Rework the topics behind these items and practise similar questions before your next activity or quiz.",
  project: "Check the project requirements with your instructor and ask whether the weakest parts can still be improved.",
  midterm: "Review the Midterm topics where you lost points.",
  final: "Review the Final Exam topics where you lost points and ask your instructor which areas to revisit.",
  attendance: "Attend every remaining session and catch up on what you missed.",
};

function fallbackScore(x: EvidenceSource): string {
  return `${x.title} ${sourceValue(x)}${x.score === 0 ? ", a recorded score of 0" : ""}`;
}

function fallbackSubjectBlock(s: SubjectRecord, now: Date): string {
  const a = analyzeWeakAreas(s, now);
  const B = a.benchmark;
  const lines = [
    `${subjectTitle(s)}:`,
    s.risk
      ? `Official risk classification: ${s.risk.label}${s.risk.score != null ? ` (risk score ${s.risk.score.toFixed(2)})` : ""}.`
      : "Official risk classification: not available yet.",
    gradeLine(s),
  ];

  if (!a.components.some((c) => c.percent != null)) {
    lines.push(
      "No scores or attendance are recorded for this subject yet, so I can't point to weak areas or give personalised steps. Check My Scores once your work is graded.",
    );
  } else if (a.ranked.length === 0) {
    lines.push(`No weighted part of your grade is below ${B}% in your records.`);
  } else {
    lines.push(`Priority areas (below ${B}%, largest effect on your provisional grade first):`);
    const final = a.components.find((c) => c.key === "final")!;
    a.ranked.slice(0, 3).forEach((c, i) => {
      const low = c.scored.filter((x) => x.percent! < B).map(fallbackScore);
      const value =
        c.key === "attendance"
          ? `${f2(c.percent!)}% (${s.attendance.present + s.attendance.late} of ${s.attendance.total} sessions present or late)`
          : `${f2(c.percent!)}%`;
      const action =
        c.key === "midterm" && final.percent == null && final.unscored.length > 0
          ? `${FALLBACK_ACTIONS.midterm} Use them to prepare for the Final Exam.`
          : FALLBACK_ACTIONS[c.key];
      lines.push(
        `${i + 1}. ${c.label}: ${value}, effective weight ${f2(c.effectiveWeight!)}% of your provisional grade.${low.length ? ` Low scores: ${low.join("; ")}.` : ""} Next step: ${action}`,
      );
    });
  }

  const missing = incompleteEvidence(a);
  if (missing.length > 0) lines.push(`Missing or not yet scored (not counted as zero): ${missing.slice(0, 5).join("; ")}.`);
  const upcoming = a.components
    .flatMap((c) => c.unscored)
    .filter((x) => x.score == null && !x.pastDue && x.dueDate)
    .sort((x, y) => dueTs(x.dueDate) - dueTs(y.dueDate))
    .slice(0, 3);
  if (upcoming.length > 0) lines.push(`Upcoming, not graded yet: ${upcoming.map((x) => `${x.title} (due ${isoDay(x.dueDate)})`).join("; ")}.`);
  if (a.unmapped.length > 0) {
    lines.push(`Not counted in your grade (assessment type not recognised): ${a.unmapped.slice(0, 5).map((x) => x.title).join("; ")}.`);
  }
  return lines.join("\n");
}

/**
 * Deterministic reply when the model is unavailable: the same weak-area analysis the prompt uses,
 * quoted from the record. It never reclassifies risk and gives no steps without academic evidence.
 */
export function buildFallbackSummary(record: StudentRecord, scope: SubjectRecord[], now: Date): string {
  const subjects = scope.length > 0 ? scope : record.subjects;
  return [
    "The AI coach is temporarily unavailable, so this summary comes straight from your records rather than AI coaching. It does not change your official risk classification.",
    ...subjects.map((s) => fallbackSubjectBlock(s, now)),
    "Please try again in a few minutes for a fuller study plan.",
  ].join("\n\n");
}

function isoDay(value: string | null): string {
  if (!value) return "";
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : "";
}

function formatSubjectBlock(s: SubjectRecord, isFocus: boolean, now: Date): string {
  const lines: string[] = [];
  lines.push(`Subject: ${subjectTitle(s)}${isFocus ? " [CURRENT FOCUS]" : ""}`);

  lines.push(finalGradePromptLine(s.finalRelease));
  if (s.provisionalGrade != null) {
    const source = s.usesDefaultWeights
      ? "default grading weights (not customized by the instructor)"
      : "the subject's grading system";
    lines.push(
      `Provisional weighted grade (NOT the official final grade): ${fmtGrade(s.provisionalGrade)} (weighted by ${source}; weights activity ${s.gradingWeights.activity}, project ${s.gradingWeights.project}, attendance ${s.gradingWeights.attendance}, exam ${s.gradingWeights.exam})`,
    );
  } else {
    lines.push("Provisional weighted grade: UNAVAILABLE (no graded work or attendance yet)");
  }
  lines.push(
    `Category averages: activity/coursework ${fmtPct(s.courseworkAverage)}, projects ${fmtPct(s.projectAverage)}, exam combined ${fmtPct(s.examAverage)} (Midterm and Final are listed separately below)`,
  );
  lines.push(
    `Average of all graded assessments: ${s.overallGradedAveragePercent != null ? `${s.overallGradedAveragePercent}%` : "n/a"} (${s.gradedCount} graded of ${s.assessments.length})`,
  );
  lines.push(
    s.attendance.total > 0
      ? `Attendance: ${s.attendance.percent}% (${s.attendance.present} present, ${s.attendance.late} late, ${s.attendance.absent} absent of ${s.attendance.total} sessions)`
      : "Attendance: no attendance recorded",
  );
  lines.push(
    s.risk
      ? `Official risk classification: ${s.risk.label}; official risk score: ${s.risk.score != null ? s.risk.score.toFixed(2) : "not recorded"}${s.risk.recordedAt ? ` (analysis ${isoDay(s.risk.recordedAt)})` : ""}`
      : "Official risk classification: NOT AVAILABLE (no risk analysis recorded for this subject)",
  );

  const limit = isFocus ? 40 : 12;
  lines.push("Assessments:");
  if (s.assessments.length === 0) lines.push("- none recorded");
  for (const a of s.assessments.slice(0, limit)) {
    const due = a.dueDate ? `, due ${isoDay(a.dueDate)}` : "";
    const status =
      a.score != null
        ? `${a.score}/${a.maxScore ?? "?"}${a.percent != null ? ` (${a.percent}%)` : ""}`
        : a.dueDate && Date.parse(a.dueDate) < now.getTime()
          ? "NO SCORE RECORDED (past due)"
          : "not graded yet";
    lines.push(`- ${a.title} [${a.typeLabel}]: ${status}${due}`);
  }
  if (s.assessments.length > limit) lines.push(`- (${s.assessments.length - limit} more not shown)`);

  lines.push(...formatWeakAreaBlock(analyzeWeakAreas(s, now), isFocus));
  return lines.join("\n");
}

export function formatEngagementBlock(e: RawEngagement): string {
  return [
    "Student engagement (system-computed):",
    `Engagement level: ${e.engagementLevel}`,
    e.engagementScore != null ? `Engagement score: ${e.engagementScore}` : null,
    `Total login count: ${e.totalLoginCount}`,
    `Participation events (30-day window): ${e.participationCount}`,
    e.recentActivities.length > 0 ? `Recent activity:\n${e.recentActivities.map((r) => `- ${r}`).join("\n")}` : "Recent activity: none recorded",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatStudentRecordForPrompt(record: StudentRecord, focus: SubjectRecord | null, now: Date): string {
  const parts = [`STUDENT RECORD (signed-in student only; today is ${now.toISOString().slice(0, 10)})`];
  if (!record.riskAvailable) parts.push("Note: risk analysis data could not be loaded; treat risk information as unavailable.");
  for (const s of record.subjects) parts.push(formatSubjectBlock(s, focus?.subjectId === s.subjectId, now));
  parts.push(record.engagement ? formatEngagementBlock(record.engagement) : "Student engagement: not available");
  return parts.join("\n\n");
}
