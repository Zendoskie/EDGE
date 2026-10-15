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
export function emailLogKey(kind: "counseling_outcome" | "instructor_feedback", id: string): string {
  const key = `${kind}:${id}`;
  if (RISK_EMAIL_LEVELS.has(key)) throw new Error("email log key collides with a risk email");
  return key;
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
