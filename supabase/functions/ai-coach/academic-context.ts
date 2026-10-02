/**
 * Pure (no Deno / network imports) helpers that turn the signed-in student's own rows
 * into an authoritative "student record" for the AI Coach.
 *
 * - `averageOf`, `computeWeightedGrade` and the assessment-type groups mirror
 *   src/lib/weighted-grading.ts and src/lib/assessment-types.ts. They are locked to the
 *   official implementation by a parity test (src/lib/ai-coach-context.test.ts).
 * - Risk classification and risk score are passed through exactly as stored by the
 *   official risk analysis. Nothing here recalculates them.
 */

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

/* ---------------------------------------------------------------- official grading (mirror) */

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

export function computeWeightedGrade(inputs: WeightedGradeInputs): number | null {
  const { weights } = inputs;
  if (!weights) return null;
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

const COURSEWORK_TYPES = new Set(["activity", "assignment", "quiz"]);
const PROJECT_TYPES = new Set(["project"]);
const EXAM_TYPES = new Set(["exam", "laboratory_exam", "midterm_exam", "final_exam"]);

export const isCourseworkType = (v: string | null | undefined) => !!v && COURSEWORK_TYPES.has(v);
export const isProjectType = (v: string | null | undefined) => !!v && PROJECT_TYPES.has(v);
export const isExamType = (v: string | null | undefined) => !!v && EXAM_TYPES.has(v);

export function assessmentTypeLabel(value: string | null | undefined): string {
  if (!value) return "Assessment";
  return ASSESSMENT_LABELS[value] ?? value.replace(/_/g, " ");
}

/* ---------------------------------------------------------------- record model */

export type RawEnrollment = {
  subject_id?: string | null;
  subjects?: { code?: string | null; name?: string | null } | Array<{ code?: string | null; name?: string | null }> | null;
};
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
};
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
  gradingWeights: { activity: number; project: number; attendance: number; exam: number } | null;
  /** Official weighted grade (computeWeightedGrade). Null when it cannot be computed. */
  officialGrade: number | null;
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
  const subjectsMeta = new Map<string, { code: string; name: string }>();
  for (const e of input.enrollments) {
    if (!e.subject_id || subjectsMeta.has(e.subject_id)) continue;
    subjectsMeta.set(e.subject_id, firstSubjectMeta(e));
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

    const byGroup = (pred: (t: string | null) => boolean) =>
      averageOf(assessments.filter((a) => pred(a.type)).map((a) => a.percent));
    const courseworkAverage = byGroup(isCourseworkType);
    const projectAverage = byGroup(isProjectType);
    const examAverage = byGroup(isExamType);

    const att = input.attendance.filter((r) => r.subject_id === subjectId);
    const present = att.filter((r) => r.status === "present").length;
    const late = att.filter((r) => r.status === "late").length;
    const absent = att.filter((r) => r.status === "absent").length;
    const attendancePercent = att.length ? ((present + late) / att.length) * 100 : null;

    const weights = input.gradingSystems.find((g) => g.subject_id === subjectId) ?? null;
    const officialGrade = computeWeightedGrade({
      activityAverage: courseworkAverage,
      projectAverage,
      attendancePercent,
      examAverage,
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
      gradingWeights: weights
        ? {
            activity: Number(weights.activity_weight) || 0,
            project: Number(weights.project_weight) || 0,
            attendance: Number(weights.attendance_weight) || 0,
            exam: Number(weights.exam_weight) || 0,
          }
        : null,
      officialGrade,
      risk: classification
        ? {
            classification,
            label: riskStatusLabel(classification),
            score:
              pred!.risk_score != null && Number.isFinite(Number(pred!.risk_score))
                ? Math.round(Number(pred!.risk_score) * 10) / 10
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

export const LOW_SCORE_THRESHOLD = 70;
export const LOW_ATTENDANCE_THRESHOLD = 75;

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

function gradeLine(s: SubjectRecord): string {
  if (s.officialGrade != null && s.gradingWeights) {
    const w = s.gradingWeights;
    const parts = [
      `Coursework ${fmtPct(s.courseworkAverage)} (weight ${w.activity})`,
      `Projects ${fmtPct(s.projectAverage)} (weight ${w.project})`,
      `Attendance ${fmtPct(s.attendance.percent)} (weight ${w.attendance})`,
      `Exams ${fmtPct(s.examAverage)} (weight ${w.exam})`,
    ];
    return `${subjectTitle(s)}: your current grade is ${Math.round(s.officialGrade)}%. This is the official weighted grade from your subject's grading system. Categories with no data yet are left out. ${parts.join("; ")}.`;
  }
  if (!s.gradingWeights) {
    const avg =
      s.overallGradedAveragePercent != null
        ? ` Your average across ${s.gradedCount} graded assessment(s) is ${s.overallGradedAveragePercent}%.`
        : " Nothing has been graded yet.";
    return `${subjectTitle(s)}: no grading system has been set up yet, so an official weighted grade isn't available.${avg}`;
  }
  return `${subjectTitle(s)}: an official grade isn't available yet because there is no graded work or attendance to calculate it from.`;
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

export function buildFallbackSummary(record: StudentRecord, scope: SubjectRecord[]): string {
  const subjects = scope.length > 0 ? scope : record.subjects;
  const blocks = subjects.map((s) => {
    const bits = [gradeLine(s)];
    bits.push(
      s.attendance.percent != null
        ? `Attendance: ${s.attendance.percent}% (${s.attendance.present + s.attendance.late} of ${s.attendance.total} sessions present or late).`
        : "Attendance: no records yet.",
    );
    bits.push(
      s.risk
        ? `Official risk classification: ${s.risk.label}${s.risk.score != null ? ` (risk score ${s.risk.score})` : ""}.`
        : "Official risk classification: not available yet.",
    );
    return bits.join("\n");
  });
  return `The AI coach is temporarily unavailable, so I can't build a personalised plan right now. Here is what your records show:\n\n${blocks.join("\n\n")}\n\nPlease try again in a few minutes for coaching advice.`;
}

/* ---------------------------------------------------------------- prompt context */

export function weakAreaFacts(s: SubjectRecord, now: Date): string[] {
  const facts: string[] = [];
  for (const a of s.assessments) {
    if (a.percent != null && a.percent < LOW_SCORE_THRESHOLD) {
      facts.push(`${a.title} (${a.typeLabel}) scored ${a.percent}%, below ${LOW_SCORE_THRESHOLD}%`);
    }
  }
  for (const a of s.assessments) {
    if (a.score == null && a.dueDate && Date.parse(a.dueDate) < now.getTime()) {
      facts.push(`${a.title} (${a.typeLabel}) has no score recorded and its due date has passed`);
    }
  }
  if (s.attendance.percent != null && s.attendance.percent < LOW_ATTENDANCE_THRESHOLD) {
    facts.push(`Attendance is ${s.attendance.percent}%, below ${LOW_ATTENDANCE_THRESHOLD}%`);
  }
  const groups: Array<[string, number | null]> = [
    ["Coursework", s.courseworkAverage],
    ["Projects", s.projectAverage],
    ["Exams", s.examAverage],
  ];
  for (const [label, avg] of groups) {
    if (avg != null && avg < LOW_SCORE_THRESHOLD) facts.push(`${label} average is ${Math.round(avg)}%, below ${LOW_SCORE_THRESHOLD}%`);
  }
  return facts;
}

function isoDay(value: string | null): string {
  if (!value) return "";
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : "";
}

function formatSubjectBlock(s: SubjectRecord, isFocus: boolean, now: Date): string {
  const lines: string[] = [];
  lines.push(`Subject: ${subjectTitle(s)}${isFocus ? " [CURRENT FOCUS]" : ""}`);

  if (s.officialGrade != null && s.gradingWeights) {
    lines.push(
      `Official current grade: ${Math.round(s.officialGrade)}% (weighted by the subject's grading system; weights activity ${s.gradingWeights.activity}, project ${s.gradingWeights.project}, attendance ${s.gradingWeights.attendance}, exam ${s.gradingWeights.exam})`,
    );
  } else if (!s.gradingWeights) {
    lines.push("Official current grade: UNAVAILABLE (no grading system configured for this subject)");
  } else {
    lines.push("Official current grade: UNAVAILABLE (no graded work or attendance yet)");
  }
  lines.push(
    `Category averages: coursework ${fmtPct(s.courseworkAverage)}, projects ${fmtPct(s.projectAverage)}, exams ${fmtPct(s.examAverage)}`,
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
      ? `Official risk classification: ${s.risk.label}; official risk score: ${s.risk.score ?? "not recorded"}${s.risk.recordedAt ? ` (analysis ${isoDay(s.risk.recordedAt)})` : ""}`
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

  const weak = weakAreaFacts(s, now);
  lines.push("Evidence-based weak areas:");
  if (weak.length === 0) lines.push("- none evidenced by the record");
  for (const w of weak.slice(0, 10)) lines.push(`- ${w}`);
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
