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
    | "counselor_followup"
    | "enrollment_request"
    | "feedback_reply"
    | "attendance_update"
    | "engagement_outcome"
    | "parent_registration_decision"
    | "registration_rejected"
    | "enrollment_decision"
    | "parent_grades_posted"
    | "parent_attendance_update"
    | "parent_risk_update"
    | "parent_referral_update",
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

/** One instructor email per pending cycle; enrolled_at is set when entering pending. */
export function enrollmentRequestLogId(enrollmentId: string, pendingStartedAt: string | null | undefined): string {
  const anchor = pendingStartedAt?.trim() || "unknown";
  return `${enrollmentId}:${anchor}`;
}

/** One student email per enrollment decision cycle (pending anchor from enrolled_at). */
export function enrollmentDecisionLogId(
  enrollmentId: string,
  decision: string,
  cycleAnchor: string | null | undefined,
): string {
  const anchor = cycleAnchor?.trim() || "unknown";
  return `${enrollmentId}:${decision}:${anchor}`;
}

/** One rejection email per registration request row. */
export function registrationRequestRejectedLogId(requestId: string, kind: string): string {
  return `${kind}:${requestId}`;
}

export function parentGradesPostedLogId(parentUserId: string, activityId: string, studentId: string): string {
  return `${parentUserId}:${activityId}:${studentId}`;
}

export function parentAttendanceUpdateLogId(
  parentUserId: string,
  studentAttendanceLogKey: string,
): string {
  return `${parentUserId}:${studentAttendanceLogKey}`;
}

export function parentRiskTransitionLogId(
  parentUserId: string,
  predictionId: string,
  previousLevel: string,
  newLevel: string,
  writeStamp: string,
): string {
  return `${parentUserId}:${predictionId}:${previousLevel}->${newLevel}:${writeStamp}`;
}

export function parentReferralUpdateLogId(
  parentUserId: string,
  referralId: string,
  event: string,
): string {
  return `${parentUserId}:${referralId}:${event}`;
}

/** Display label for canonical risk bands stored on predictions. */
export function canonicalRiskBandLabel(level: string | null | undefined): string {
  const normalized = (level ?? "").trim().toLowerCase();
  if (normalized === "critical") return "Crucial";
  if (normalized === "at_risk") return "Vulnerable";
  if (normalized === "stable") return "Stable";
  if (normalized === "excelling") return "Excelling";
  return escapeHtml(level?.trim() || "Updated");
}

export function shouldNotifyParentRiskTransition(
  previousLevel: string | null | undefined,
  newLevel: string | null | undefined,
): boolean {
  const prev = (previousLevel ?? "").trim().toLowerCase();
  const next = (newLevel ?? "").trim().toLowerCase();
  if (!prev || !next) return false;
  return prev !== next;
}

/** One email per committed student decision on a registration request. */
export function parentRegistrationDecisionLogId(requestId: string, decisionType: string): string {
  return `${requestId}:${decisionType}`;
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

export function counselorFollowupEmail(input: {
  subjectCode?: string | null;
  message?: string | null;
}): { subject: string; html: string } {
  const code = input.subjectCode?.trim() ?? "";
  const subject = code ? `EDGE: Counseling follow-up — ${code}` : "EDGE: Counseling follow-up";
  const where = code ? ` for <strong>${escapeHtml(code)}</strong>` : "";
  const message = input.message?.trim();
  const messageBlock = message
    ? `<p><strong>Message:</strong> ${escapeHtml(message)}</p>`
    : "<p>Sign in to EDGE to read the follow-up.</p>";
  return {
    subject,
    html: `<div style="font-family: sans-serif; line-height: 1.5;"><p>Your guidance counselor logged an engagement follow-up${where}.</p>${messageBlock}<p style="color:#666;font-size:12px;">EDGE — Student Risk Analysis and AI Coaching System</p></div>`,
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

export function engagementOutcomeRatingLabel(rating: string | null | undefined): string {
  const normalized = rating?.trim().toLowerCase() ?? "";
  if (normalized === "improved") return "Improved";
  if (normalized === "no_change") return "No change";
  if (normalized === "declined") return "Declined";
  if (!normalized) return "Recorded";
  return escapeHtml(rating!.trim());
}

export function counselingOutcomeEmail(input: {
  subjectCode?: string | null;
  message?: string | null;
  outcomeRating?: string | null;
  outcomeNote?: string | null;
}): { subject: string; html: string } {
  const code = input.subjectCode?.trim() ?? "";
  const subject = code ? `EDGE: Follow-up outcome recorded — ${code}` : "EDGE: Follow-up outcome recorded";
  const where = code ? ` for <strong>${escapeHtml(code)}</strong>` : "";
  const message = input.message?.trim();
  const outcome = engagementOutcomeRatingLabel(input.outcomeRating);
  const note = input.outcomeNote?.trim();
  const parts = [
    `<p>Your follow-up outcome${where} has been recorded.</p>`,
    message ? `<p><strong>Message:</strong> ${escapeHtml(message)}</p>` : "",
    `<p><strong>Outcome:</strong> ${escapeHtml(outcome)}</p>`,
    note ? `<p><strong>Note:</strong> ${escapeHtml(note)}</p>` : "",
    "<p>Sign in to EDGE to review the details.</p>",
    '<p style="color:#666;font-size:12px;">EDGE — Student Risk Analysis and AI Coaching System</p>',
  ].filter(Boolean);
  return {
    subject,
    html: `<div style="font-family: sans-serif; line-height: 1.5;">${parts.join("")}</div>`,
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

/** Student on the stored engagement intervention. Owner is intervention.instructor_id (not user_roles). */
export function engagementInterventionRecipient(input: {
  callerId: string;
  intervention: { studentId: string; instructorId: string; actionType: string } | null;
  callerIsInstructor?: boolean;
}): string | null {
  if (input.callerIsInstructor === false || !input.intervention) return null;
  if (!input.callerId || input.callerId !== input.intervention.instructorId) return null;
  if (!shouldEmailEngagementIntervention(input.intervention.actionType)) return null;
  if (!input.intervention.studentId) return null;
  return input.intervention.studentId;
}

export function engagementInterventionEmail(input: {
  subjectCode?: string | null;
  message?: string | null;
}): { subject: string; html: string } {
  const code = input.subjectCode?.trim() ?? "";
  const subject = code ? `EDGE: Instructor follow-up — ${code}` : "EDGE: Instructor follow-up";
  const where = code ? ` for <strong>${escapeHtml(code)}</strong>` : "";
  const message = input.message?.trim();
  const messageBlock = message
    ? `<p>${escapeHtml(message)}</p>`
    : "<p>Sign in to EDGE to read your instructor's follow-up.</p>";
  return {
    subject,
    html: `<div style="font-family: sans-serif; line-height: 1.5;"><p>Your instructor logged a follow-up${where}.</p>${messageBlock}<p style="color:#666;font-size:12px;">EDGE — Student Risk Analysis and AI Coaching System</p></div>`,
  };
}

/** Instructor-completed engagement outcome (not guidance_counseling). */
export function engagementOutcomeRecipient(input: {
  callerId: string;
  intervention: {
    studentId: string;
    instructorId: string;
    status: string;
    completedBy: string | null;
  } | null;
}): string | null {
  if (!input.intervention) return null;
  if (input.intervention.status !== "completed") return null;
  const allowed =
    input.callerId === input.intervention.instructorId ||
    (input.intervention.completedBy && input.callerId === input.intervention.completedBy);
  if (!allowed) return null;
  return input.intervention.studentId || null;
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

export function interventionStudentEmail(input?: {
  subjectCode?: string | null;
  message?: string | null;
}): { subject: string; html: string } {
  const code = input?.subjectCode?.trim() ?? "";
  const message = input?.message?.trim() ?? "";
  const subject = code ? `EDGE: Intervention logged — ${code}` : "EDGE: Intervention logged";
  const where = code ? ` for <strong>${escapeHtml(code)}</strong>` : "";
  const messageBlock = message
    ? `<p><strong>Message:</strong> ${escapeHtml(message)}</p>`
    : "";
  return {
    subject,
    html: `<div style="font-family: sans-serif; line-height: 1.5;"><p>Your instructor logged an intervention${where}.</p>${messageBlock}<p>Sign in to EDGE to read it.</p><p style="color:#666;font-size:12px;">EDGE — Student Risk Analysis and AI Coaching System</p></div>`,
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

export function enrollmentRequestRecipient(input: {
  callerId: string;
  enrollment: { studentId: string; status: string; instructorId: string | null } | null;
}): string | null {
  if (!input.enrollment) return null;
  if (input.enrollment.status !== "pending") return null;
  if (!input.callerId || input.callerId !== input.enrollment.studentId) return null;
  if (!input.enrollment.instructorId) return null;
  return input.enrollment.instructorId;
}

/** Student receiving an instructor's enrollment approve/reject decision. */
export function enrollmentDecisionStudentId(input: {
  enrollment: { studentId: string; status: string; instructorId: string | null } | null;
  callerId: string;
}): string | null {
  if (!input.enrollment) return null;
  if (!input.enrollment.instructorId || input.callerId !== input.enrollment.instructorId) return null;
  if (input.enrollment.status !== "active" && input.enrollment.status !== "rejected") return null;
  return input.enrollment.studentId || null;
}

export function registrationRequestRejectedEmail(input: {
  fullName?: string | null;
  roleLabel: string;
  rejectionReason?: string | null;
}): { subject: string; html: string } {
  const name = escapeHtml(input.fullName?.trim() || "Applicant");
  const role = escapeHtml(input.roleLabel.trim() || "applicant");
  const reason = input.rejectionReason?.trim();
  const reasonBlock = reason
    ? `<p><strong>Reason:</strong> ${escapeHtml(reason)}</p>`
    : "";
  return {
    subject: "EDGE: Your registration request was not approved",
    html: `<div style="font-family: sans-serif; line-height: 1.5;"><p>Hi ${name},</p><p>Your request to register as <strong>${role}</strong> on EDGE was <strong>not approved</strong> by the administrator.</p>${reasonBlock}<p>If you have questions, contact your institution's administrator.</p><p style="color:#666;font-size:12px;">EDGE — Student Risk Analysis and AI Coaching System</p></div>`,
  };
}

export function enrollmentDecisionEmail(input: {
  subjectCode?: string | null;
  decision: "approved" | "rejected";
}): { subject: string; html: string } {
  const code = escapeHtml(input.subjectCode?.trim() || "your course");
  if (input.decision === "approved") {
    return {
      subject: `EDGE: Enrollment approved — ${code}`,
      html: `<div style="font-family: sans-serif; line-height: 1.5;"><p>Your enrollment request for <strong>${code}</strong> was <strong>approved</strong>.</p><p>Sign in to EDGE to access the course.</p><p style="color:#666;font-size:12px;">EDGE — Student Risk Analysis and AI Coaching System</p></div>`,
    };
  }
  return {
    subject: `EDGE: Enrollment request declined — ${code}`,
    html: `<div style="font-family: sans-serif; line-height: 1.5;"><p>Your enrollment request for <strong>${code}</strong> was <strong>not approved</strong> at this time.</p><p>Sign in to EDGE if you would like to submit a new request.</p><p style="color:#666;font-size:12px;">EDGE — Student Risk Analysis and AI Coaching System</p></div>`,
  };
}

export function parentGradesPostedEmail(input: {
  studentName?: string | null;
  subjectCode?: string | null;
  lines: Array<{ title: string; score: number }>;
}): { subject: string; html: string } {
  const student = escapeHtml(input.studentName?.trim() || "Your student");
  const code = escapeHtml(input.subjectCode?.trim() || "a course");
  const list = input.lines.map((line) => `${escapeHtml(line.title)}: ${line.score}`).join("<br>");
  return {
    subject: `EDGE: ${code} — Grade update for ${student}`,
    html: `<div style="font-family: sans-serif; line-height: 1.5;"><p>A new grade is available for <strong>${student}</strong> in <strong>${code}</strong>.</p><p>${list}</p><p>Sign in to EDGE to review details for your linked student.</p><p style="color:#666;font-size:12px;">EDGE — Student Risk Analysis and AI Coaching System</p></div>`,
  };
}

export function parentAttendanceUpdateEmail(input: {
  studentName?: string | null;
  subjectCode?: string | null;
  date: string;
  status: string;
}): { subject: string; html: string } {
  const student = escapeHtml(input.studentName?.trim() || "your student");
  const code = escapeHtml(input.subjectCode?.trim() || "a course");
  const date = escapeHtml(input.date.trim());
  const status = escapeHtml(input.status.trim() || "recorded");
  return {
    subject: `EDGE: Attendance update for ${student} — ${code}`,
    html: `<div style="font-family: sans-serif; line-height: 1.5;"><p>Attendance for <strong>${student}</strong> in <strong>${code}</strong> on <strong>${date}</strong> was recorded as <strong>${status}</strong>.</p><p>Sign in to EDGE to review your linked student&apos;s record.</p><p style="color:#666;font-size:12px;">EDGE — Student Risk Analysis and AI Coaching System</p></div>`,
  };
}

export function parentRiskTransitionEmail(input: {
  studentName?: string | null;
  subjectCode?: string | null;
  previousLevel: string;
  newLevel: string;
}): { subject: string; html: string } {
  const student = escapeHtml(input.studentName?.trim() || "your student");
  const code = escapeHtml(input.subjectCode?.trim() || "a course");
  const fromLabel = canonicalRiskBandLabel(input.previousLevel);
  const toLabel = canonicalRiskBandLabel(input.newLevel);
  return {
    subject: `EDGE: Risk status update for ${student} — ${code}`,
    html: `<div style="font-family: sans-serif; line-height: 1.5;"><p>The academic risk status for <strong>${student}</strong> in <strong>${code}</strong> changed from <strong>${fromLabel}</strong> to <strong>${toLabel}</strong>.</p><p>Sign in to EDGE for more context about your linked student.</p><p style="color:#666;font-size:12px;">EDGE — Student Risk Analysis and AI Coaching System</p></div>`,
  };
}

export function parentReferralUpdateEmail(input: {
  studentName?: string | null;
  subjectCode?: string | null;
  event: "referral_created" | "referral_decided";
  decision?: string | null;
}): { subject: string; html: string } {
  const student = escapeHtml(input.studentName?.trim() || "your student");
  const code = escapeHtml(input.subjectCode?.trim() || "a course");
  if (input.event === "referral_created") {
    return {
      subject: `EDGE: Counseling referral for ${student}`,
      html: `<div style="font-family: sans-serif; line-height: 1.5;"><p>A counseling referral was submitted for <strong>${student}</strong> in <strong>${code}</strong>.</p><p>Sign in to EDGE if you need to follow up with your linked student or the school.</p><p style="color:#666;font-size:12px;">EDGE — Student Risk Analysis and AI Coaching System</p></div>`,
    };
  }
  const decision = input.decision === "approved" ? "approved" : "updated";
  return {
    subject: `EDGE: Counseling referral ${decision} — ${student}`,
    html: `<div style="font-family: sans-serif; line-height: 1.5;"><p>A counseling referral for <strong>${student}</strong> in <strong>${code}</strong> was <strong>${escapeHtml(decision)}</strong>.</p><p>Sign in to EDGE for available details.</p><p style="color:#666;font-size:12px;">EDGE — Student Risk Analysis and AI Coaching System</p></div>`,
  };
}

export function enrollmentRequestEmail(input: {
  studentName?: string | null;
  subjectCode?: string | null;
}): { subject: string; html: string } {
  const student = escapeHtml(input.studentName?.trim() || "A student");
  const code = escapeHtml(input.subjectCode?.trim() || "your course");
  return {
    subject: "EDGE: New enrollment request",
    html: `<div style="font-family: sans-serif; line-height: 1.5;"><p>${student} requested enrollment in <strong>${code}</strong>.</p><p>Sign in to EDGE to approve or reject the request.</p><p style="color:#666;font-size:12px;">EDGE — Student Risk Analysis and AI Coaching System</p></div>`,
  };
}

export function feedbackReplyRecipient(input: {
  callerId: string;
  callerIsInstructor: boolean;
  feedback: { studentId: string; instructorId: string } | null;
}): string | null {
  if (!input.callerIsInstructor || !input.feedback) return null;
  if (!input.callerId || input.callerId !== input.feedback.instructorId) return null;
  return input.feedback.studentId || null;
}

export function feedbackReplyEmail(input: {
  subjectLabel?: string | null;
  replyPreview?: string | null;
}): { subject: string; html: string } {
  const label = escapeHtml(input.subjectLabel?.trim() || "your feedback");
  const preview = input.replyPreview?.trim();
  const body = preview
    ? `<p><strong>Reply:</strong> ${escapeHtml(preview)}</p>`
    : "<p>Sign in to EDGE to read the full reply.</p>";
  return {
    subject: "EDGE: Instructor replied to your feedback",
    html: `<div style="font-family: sans-serif; line-height: 1.5;"><p>Your instructor replied to ${label}.</p>${body}<p style="color:#666;font-size:12px;">EDGE — Student Risk Analysis and AI Coaching System</p></div>`,
  };
}

export function attendanceUpdateRecipient(input: {
  callerId: string;
  callerIsInstructor: boolean;
  attendance: { studentId: string; subjectInstructorId: string | null } | null;
}): string | null {
  if (!input.callerIsInstructor || !input.attendance) return null;
  if (!input.attendance.subjectInstructorId || input.callerId !== input.attendance.subjectInstructorId) return null;
  return input.attendance.studentId || null;
}

export function validateCommittedAttendanceStatus(
  persistedStatus: string | null | undefined,
  committedStatus: string | null | undefined,
): string {
  if (!committedStatus?.trim()) throw new Error("status is required");
  const savedStatus = committedStatus.trim().toLowerCase();
  const persisted = persistedStatus?.trim().toLowerCase() || "";
  if (persisted !== savedStatus) {
    throw new Error("Attendance status does not match the committed change");
  }
  return savedStatus;
}

export type AttendanceEmailLogRow = { risk_level: string; sent_at?: string | null };

export function parseAttendanceUpdateLogKey(
  riskLevel: string,
  attendanceId: string,
): { status: string; revision: number } | null {
  const head = `attendance_update:${attendanceId}:`;
  if (!riskLevel.startsWith(head)) return null;
  const rest = riskLevel.slice(head.length);
  const withRevision = rest.match(/^([^:]+):r(\d+)$/);
  if (withRevision) {
    return {
      status: withRevision[1].toLowerCase(),
      revision: Number.parseInt(withRevision[2], 10),
    };
  }
  if (/^[^:]+$/.test(rest)) {
    return { status: rest.toLowerCase(), revision: 1 };
  }
  return null;
}

export function attendanceUpdateLogId(
  attendanceId: string,
  status: string,
  priorLogs: AttendanceEmailLogRow[] = [],
): string {
  const normalized = status.trim().toLowerCase() || "unknown";
  const parsed = priorLogs
    .map((row) => {
      const entry = parseAttendanceUpdateLogKey(row.risk_level, attendanceId);
      if (!entry) return null;
      return { ...entry, sent_at: row.sent_at ?? "", risk_level: row.risk_level };
    })
    .filter((row): row is { status: string; revision: number; sent_at: string; risk_level: string } => row !== null)
    .sort(
      (a, b) =>
        a.sent_at.localeCompare(b.sent_at) ||
        a.risk_level.localeCompare(b.risk_level) ||
        a.revision - b.revision,
    );

  const latest = parsed[parsed.length - 1];
  if (latest && latest.status === normalized) {
    return `${attendanceId}:${normalized}:r${latest.revision}`;
  }

  const maxRevisionForStatus = parsed
    .filter((row) => row.status === normalized)
    .reduce((max, row) => Math.max(max, row.revision), 0);
  return `${attendanceId}:${normalized}:r${maxRevisionForStatus + 1}`;
}

export function buildAttendanceUpdateEmailLogKey(
  attendanceId: string,
  committedStatus: string,
  priorLogs: AttendanceEmailLogRow[] = [],
): string {
  return emailLogKey("attendance_update", attendanceUpdateLogId(attendanceId, committedStatus, priorLogs));
}

export function attendanceUpdateEmail(input: {
  subjectCode?: string | null;
  date: string;
  status: string;
}): { subject: string; html: string } {
  const code = escapeHtml(input.subjectCode?.trim() || "your subject");
  const date = escapeHtml(input.date.trim());
  const status = escapeHtml(input.status.trim() || "recorded");
  return {
    subject: `EDGE: Attendance updated — ${code}`,
    html: `<div style="font-family: sans-serif; line-height: 1.5;"><p>Your attendance for <strong>${code}</strong> on <strong>${date}</strong> was recorded as <strong>${status}</strong>.</p><p>Sign in to EDGE to review your attendance record.</p><p style="color:#666;font-size:12px;">EDGE — Student Risk Analysis and AI Coaching System</p></div>`,
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
