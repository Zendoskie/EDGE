const RISK_EMAIL_LEVELS = new Set(["critical", "at_risk", "stable", "excelling"]);

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Send-log key stored on email_notifications.risk_level. Must not be a risk band. */
export function emailLogKey(
  kind:
    | "counseling_outcome"
    | "instructor_feedback"
    | "engagement_intervention"
    | "logged_intervention"
    | "grades_posted"
    | "risk_feedback"
    | "counselor_followup",
  id: string,
): string {
  const key = `${kind}:${id}`;
  if (RISK_EMAIL_LEVELS.has(key)) throw new Error("email log key collides with a risk email");
  return key;
}

/** Stable per-assessment/student key for grades_posted send-log rows. */
export function gradesPostedLogId(activityId: string, studentId: string): string {
  return `${activityId}:${studentId}`;
}

/** Caller may email grades for this subject. */
export function authorizeGradesPostedCaller(input: {
  callerIsInstructor: boolean;
  callerId: string;
  subjectInstructorId: string | null;
}): boolean {
  if (!input.callerIsInstructor || !input.callerId) return false;
  if (!input.subjectInstructorId) return false;
  return input.callerId === input.subjectInstructorId;
}

/**
 * Keep only stored non-null scores whose activity belongs to the subject.
 * Missing/null scores are dropped; a recorded 0 is kept.
 */
export function selectGradesPostedLines(input: {
  items: Array<{ activityId: string; studentId: string }>;
  activitySubjectId: ReadonlyMap<string, string>;
  subjectId: string;
  scoreByPair: ReadonlyMap<string, number | null | undefined>;
  titleByActivityId: ReadonlyMap<string, string>;
}): Array<{ studentId: string; activityId: string; title: string; score: number }> {
  const out: Array<{ studentId: string; activityId: string; title: string; score: number }> = [];
  for (const item of input.items) {
    if (input.activitySubjectId.get(item.activityId) !== input.subjectId) continue;
    const score = input.scoreByPair.get(gradesPostedLogId(item.activityId, item.studentId));
    if (score == null || !Number.isFinite(score)) continue;
    out.push({
      studentId: item.studentId,
      activityId: item.activityId,
      title: input.titleByActivityId.get(item.activityId)?.trim() || "Activity",
      score,
    });
  }
  return out;
}

export function gradesPostedEmail(
  subjectCode: string | null | undefined,
  lines: Array<{ title: string; score: number }>,
): { subject: string; html: string } {
  const code = subjectCode?.trim() || "your subject";
  const list = lines.map((line) => `${escapeHtml(line.title)}: ${line.score}`).join("<br>");
  return {
    subject: `EDGE: ${code} — Grades posted`,
    html: `<div style="font-family: sans-serif; line-height: 1.5;"><p>A grade is now available for <strong>${escapeHtml(code)}</strong>.</p><p>${list}</p><p>Sign in to EDGE to review your scores.</p><p style="color:#666;font-size:12px;">EDGE — Student Risk Analysis and AI Coaching System</p></div>`,
  };
}

/**
 * Drop pairs that already have a successful send-log.
 * Retry emails include only remaining lines for that student.
 */
export function omitLoggedGradesPostedLines<T extends { activityId: string; studentId: string }>(
  lines: readonly T[],
  loggedPairKeys: ReadonlySet<string>,
): T[] {
  return lines.filter(
    (line) => !loggedPairKeys.has(gradesPostedLogId(line.activityId, line.studentId)),
  );
}

/** Student who owns the stored risk-feedback row. */
export function authorizeRiskFeedbackEmail(input: {
  callerId: string;
  callerRole: string | null;
  feedback: { studentId: string; subjectId: string } | null;
}): { studentId: string; subjectId: string } | null {
  if (input.callerRole !== "student") return null;
  if (!input.feedback) return null;
  if (!input.callerId || input.feedback.studentId !== input.callerId) return null;
  if (!input.feedback.subjectId) return null;
  return { studentId: input.feedback.studentId, subjectId: input.feedback.subjectId };
}

/** Exact subject instructor. Null instructor fails closed. */
export function riskFeedbackInstructor(subjectInstructorId: string | null | undefined): string | null {
  const id = subjectInstructorId?.trim() ?? "";
  return id || null;
}

export function riskFeedbackEmail(input: {
  studentName?: string | null;
  subjectCode?: string | null;
}): { subject: string; html: string } {
  const student = escapeHtml(input.studentName?.trim() || "A student");
  const code = input.subjectCode?.trim();
  const where = code ? ` for <strong>${escapeHtml(code)}</strong>` : "";
  return {
    subject: "EDGE: New student feedback",
    html: `<div style="font-family: sans-serif; line-height: 1.5;"><p>${student} submitted risk feedback${where}.</p><p>Sign in to EDGE to review it.</p><p style="color:#666;font-size:12px;">EDGE — Student Risk Analysis and AI Coaching System</p></div>`,
  };
}

/** Student on a counselor-logged guidance_counseling intervention. */
export function counselorFollowupRecipient(input: {
  callerIsCounselor: boolean;
  callerId: string;
  intervention: {
    studentId: string;
    instructorId: string;
    actionType: string;
    status: string;
  } | null;
}): string | null {
  if (!input.callerIsCounselor || !input.intervention) return null;
  if (input.intervention.status === "cancelled") return null;
  if (input.intervention.actionType !== "guidance_counseling") return null;
  if (!input.callerId || input.callerId !== input.intervention.instructorId) return null;
  if (!input.intervention.studentId) return null;
  return input.intervention.studentId;
}

export function counselorFollowupEmail(subjectCode?: string | null): { subject: string; html: string } {
  const code = subjectCode?.trim() ?? "";
  const subject = code ? `EDGE: Counseling follow-up — ${code}` : "EDGE: Counseling follow-up";
  const where = code ? ` for <strong>${escapeHtml(code)}</strong>` : "";
  return {
    subject,
    html: `<div style="font-family: sans-serif; line-height: 1.5;"><p>Your guidance counselor logged an engagement follow-up${where}.</p><p>Sign in to EDGE to read it. This message does not include private counseling notes.</p><p style="color:#666;font-size:12px;">EDGE — Student Risk Analysis and AI Coaching System</p></div>`,
  };
}

export function isRiskEmailLevel(value: string): boolean {
  return RISK_EMAIL_LEVELS.has(value);
}

export function shouldSendCounselingOutcomeEmail(actionType: string, actorRole: string): boolean {
  return actionType === "guidance_counseling" && actorRole === "guidance_counselor";
}

/** Student who should receive the outcome email. Null for every other caller or event. */
export function counselingOutcomeRecipient(input: {
  callerIsCounselor: boolean;
  actionType: string;
  actorRole: string;
  status: string;
  studentId: string;
  callerId: string;
  ownerId: string;
  completedBy: string | null;
}): string | null {
  if (!input.callerIsCounselor) return null;
  if (input.status !== "completed") return null;
  if (!shouldSendCounselingOutcomeEmail(input.actionType, input.actorRole)) return null;
  if (input.callerId !== input.completedBy && input.callerId !== input.ownerId) return null;
  if (!input.studentId) return null;
  return input.studentId;
}

/**
 * Student who owns this stored feedback row. Client-supplied student or instructor ids are ignored.
 * Null when the caller is not that student.
 */
export function authorizeFeedbackEmail(input: {
  callerId: string;
  callerRole: string | null;
  feedback: { studentId: string; topic: string | null } | null;
}): { studentId: string; topic: string | null } | null {
  if (input.callerRole !== "student") return null;
  if (!input.feedback) return null;
  if (!input.callerId || input.feedback.studentId !== input.callerId) return null;
  return { studentId: input.feedback.studentId, topic: input.feedback.topic };
}

export function counselingOutcomeEmail(subjectCode?: string | null): { subject: string; html: string } {
  const code = subjectCode?.trim() ?? "";
  const subject = code ? `EDGE: Counseling outcome recorded — ${code}` : "EDGE: Counseling outcome recorded";
  const where = code ? ` for <strong>${escapeHtml(code)}</strong>` : "";
  return {
    subject,
    html: `<div style="font-family: sans-serif; line-height: 1.5;"><p>Your counseling outcome${where} has been recorded.</p><p>Sign in to EDGE to review it. This message does not include counseling notes.</p><p style="color:#666;font-size:12px;">EDGE — Student Risk Analysis and AI Coaching System</p></div>`,
  };
}

export type EnrollmentInstructor = {
  instructorId: string;
  code: string | null;
  name: string | null;
};

type SubjectEmbed = {
  instructor_id?: string | null;
  code?: string | null;
  name?: string | null;
} | null;

/** One responsible instructor. A topic match wins. Otherwise only a sole enrolled instructor. */
export function responsibleFeedbackInstructor(
  topic: string | null | undefined,
  enrollments: EnrollmentInstructor[],
): string | null {
  const rows = enrollments.filter((row) => row.instructorId);
  const normalized = topic?.trim().toLowerCase() ?? "";
  if (normalized) {
    const matched = rows.filter((row) => {
      const code = row.code?.trim().toLowerCase() ?? "";
      const name = row.name?.trim().toLowerCase() ?? "";
      return (code !== "" && code === normalized) || (name !== "" && name === normalized);
    });
    const ids = [...new Set(matched.map((row) => row.instructorId))];
    if (ids.length === 1) return ids[0];
    if (matched.length > 0) return null;
  }
  const ids = [...new Set(rows.map((row) => row.instructorId))];
  return ids.length === 1 ? ids[0] : null;
}

export function enrollmentInstructors(
  rows: Array<{ subjects?: SubjectEmbed | SubjectEmbed[] | null }>,
): EnrollmentInstructor[] {
  const out: EnrollmentInstructor[] = [];
  for (const row of rows) {
    const subject = Array.isArray(row.subjects) ? row.subjects[0] : row.subjects;
    const instructorId = subject?.instructor_id ?? "";
    if (!instructorId) continue;
    out.push({
      instructorId,
      code: subject?.code ?? null,
      name: subject?.name ?? null,
    });
  }
  return out;
}

const ENGAGEMENT_INTERVENTION_EMAIL_ACTIONS = new Set([
  "send_reminder",
  "send_email_reminder",
  "schedule_consultation",
  "parent_contact",
  "provide_learning_materials",
]);

/** Instructor actions that already write the student inbox. Counseling outcome stays separate. */
export function shouldEmailEngagementIntervention(actionType: string): boolean {
  return ENGAGEMENT_INTERVENTION_EMAIL_ACTIONS.has(actionType);
}

/** Student on the stored engagement intervention. Null for any other caller or action. */
export function engagementInterventionRecipient(input: {
  callerIsInstructor: boolean;
  callerId: string;
  intervention: { studentId: string; instructorId: string; actionType: string } | null;
}): string | null {
  if (!input.callerIsInstructor || !input.intervention) return null;
  if (!input.callerId || input.callerId !== input.intervention.instructorId) return null;
  if (!shouldEmailEngagementIntervention(input.intervention.actionType)) return null;
  if (!input.intervention.studentId) return null;
  return input.intervention.studentId;
}

/** Student on the stored subject intervention. Caller must own that subject. */
export function loggedInterventionRecipient(input: {
  callerIsInstructor: boolean;
  callerId: string;
  intervention: { studentId: string; subjectInstructorId: string | null } | null;
}): string | null {
  if (!input.callerIsInstructor || !input.intervention) return null;
  if (!input.intervention.subjectInstructorId) return null;
  if (!input.callerId || input.callerId !== input.intervention.subjectInstructorId) return null;
  if (!input.intervention.studentId) return null;
  return input.intervention.studentId;
}

export function interventionStudentEmail(subjectCode?: string | null): { subject: string; html: string } {
  const code = subjectCode?.trim() ?? "";
  const subject = code ? `EDGE: Intervention logged — ${code}` : "EDGE: Intervention logged";
  const where = code ? ` for <strong>${escapeHtml(code)}</strong>` : "";
  return {
    subject,
    html: `<div style="font-family: sans-serif; line-height: 1.5;"><p>Your instructor logged an intervention${where}.</p><p>Sign in to EDGE to read it.</p><p style="color:#666;font-size:12px;">EDGE — Student Risk Analysis and AI Coaching System</p></div>`,
  };
}

export function instructorFeedbackEmail(input: {
  studentName?: string | null;
  topic?: string | null;
}): { subject: string; html: string } {
  const student = escapeHtml(input.studentName?.trim() || "A student");
  const topic = escapeHtml(input.topic?.trim() || "general feedback");
  return {
    subject: "EDGE: New student feedback",
    html: `<div style="font-family: sans-serif; line-height: 1.5;"><p>${student} submitted new feedback: ${topic}.</p><p>Sign in to EDGE to review it.</p><p style="color:#666;font-size:12px;">EDGE — Student Risk Analysis and AI Coaching System</p></div>`,
  };
}

/**
 * Send first. Write the log only after the provider accepts the message.
 * shortcut: a failed log insert can let a later retry send again, add a unique key on email_notifications when this key needs a hard guard.
 */
export async function deliverEmail(opts: {
  alreadyLogged: boolean;
  send: () => Promise<void>;
  log: () => Promise<void>;
}): Promise<"duplicate" | "sent" | "failed"> {
  if (opts.alreadyLogged) return "duplicate";
  try {
    await opts.send();
  } catch {
    return "failed";
  }
  try {
    await opts.log();
  } catch {
    /* email already left; do not report it as unsent */
  }
  return "sent";
}
