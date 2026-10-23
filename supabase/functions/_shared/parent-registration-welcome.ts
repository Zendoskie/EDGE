/** Eligibility for the post-completion welcome email (registration path only). */

/** Matches `src/lib/parent-email-match.ts` — keep in sync for compare semantics. */
export function normalizeEmailForCompare(email: string | null | undefined): string {
  if (!email) return "";
  return email.trim().toLowerCase();
}

export function parentRegistrationEmailsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return normalizeEmailForCompare(a) === normalizeEmailForCompare(b);
}

export const PARENT_REGISTRATION_APPROVED_STATUS = "approved";
export const PARENT_INVITATION_ACCEPTED_STATUS = "accepted";
export const PARENT_INVITATION_PARENT_ROLE = "parent";
export const PARENT_STUDENT_LINK_APPROVED_STATUS = "approved";

export type RegistrationWelcomeContext = {
  invitationRole: string;
  invitationStatus: string;
  invitationEmail: string;
  requestStatus: string;
  requestCompletedAt: string | null;
  requestEmail: string;
  linkStatus: string | null;
  /** Profile email for the approved parent account on the link (if resolved). */
  parentProfileEmail: string | null;
};

export type RegistrationWelcomeEligibility =
  | { eligible: true }
  | { eligible: false; reason: string };

export function validateRegistrationWelcomeEligibility(
  ctx: RegistrationWelcomeContext,
): RegistrationWelcomeEligibility {
  if (ctx.invitationRole !== PARENT_INVITATION_PARENT_ROLE) {
    return { eligible: false, reason: "invitation_role_not_parent" };
  }
  if (ctx.invitationStatus !== PARENT_INVITATION_ACCEPTED_STATUS) {
    return { eligible: false, reason: "invitation_not_accepted" };
  }
  if (ctx.requestStatus !== PARENT_REGISTRATION_APPROVED_STATUS) {
    return { eligible: false, reason: "request_not_approved" };
  }
  if (!ctx.requestCompletedAt?.trim()) {
    return { eligible: false, reason: "registration_not_completed" };
  }
  if (ctx.linkStatus !== PARENT_STUDENT_LINK_APPROVED_STATUS) {
    return { eligible: false, reason: "parent_link_not_approved" };
  }

  const requestEmail = normalizeEmailForCompare(ctx.requestEmail);
  const invitationEmail = normalizeEmailForCompare(ctx.invitationEmail);
  const profileEmail = normalizeEmailForCompare(ctx.parentProfileEmail);

  if (!requestEmail || !invitationEmail) {
    return { eligible: false, reason: "missing_registration_email" };
  }
  if (requestEmail !== invitationEmail) {
    return { eligible: false, reason: "invitation_request_email_mismatch" };
  }
  if (!profileEmail) {
    return { eligible: false, reason: "parent_profile_not_found" };
  }
  if (profileEmail !== requestEmail) {
    return { eligible: false, reason: "parent_profile_email_mismatch" };
  }

  return { eligible: true };
}

/** @deprecated Use validateRegistrationWelcomeEligibility for explicit checks. */
export function isRegistrationWelcomeEligible(ctx: {
  invitationStatus: string;
  requestCompletedAt: string | null;
  requestEmail: string;
  invitationEmail: string;
  linkStatus: string | null;
}): boolean {
  return validateRegistrationWelcomeEligibility({
    invitationRole: PARENT_INVITATION_PARENT_ROLE,
    invitationStatus: ctx.invitationStatus,
    invitationEmail: ctx.invitationEmail,
    requestStatus: PARENT_REGISTRATION_APPROVED_STATUS,
    requestCompletedAt: ctx.requestCompletedAt,
    requestEmail: ctx.requestEmail,
    linkStatus: ctx.linkStatus,
    parentProfileEmail: ctx.requestEmail,
  }).eligible;
}

export function registrationWelcomeDecisionId(requestId: string, completedAtIso: string): string {
  return `registration_access_activated:${completedAtIso}`;
}
