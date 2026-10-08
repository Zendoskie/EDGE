/**
 * Two-step parent/guardian verification statuses stored in parent_student_links.status.
 *
 * pending        -> awaiting the student's decision
 * pending_admin  -> student approved, awaiting an administrator
 * approved       -> administrator approved; the only status that grants data access
 * rejected       -> rejected by the student
 * admin_rejected -> rejected by an administrator
 */
export type ParentLinkStatus = "pending" | "pending_admin" | "approved" | "rejected" | "admin_rejected";

export function normalizeParentLinkStatus(status: unknown): ParentLinkStatus {
  if (typeof status !== "string") return "pending";
  const s = status.trim().toLowerCase();
  if (s === "pending_admin" || s === "approved" || s === "rejected" || s === "admin_rejected") return s;
  return "pending";
}

export function parentLinkStatusLabel(status: unknown): string {
  switch (normalizeParentLinkStatus(status)) {
    case "pending":
      return "Awaiting student approval";
    case "pending_admin":
      return "Awaiting admin approval";
    case "approved":
      return "Active";
    case "rejected":
      return "Rejected by student";
    case "admin_rejected":
      return "Rejected by admin";
  }
}

export type ApprovalStepState = "pending" | "approved" | "rejected" | "not_started";

export function studentApprovalState(status: unknown): ApprovalStepState {
  switch (normalizeParentLinkStatus(status)) {
    case "pending":
      return "pending";
    case "rejected":
      return "rejected";
    default:
      return "approved";
  }
}

export function adminApprovalState(status: unknown): ApprovalStepState {
  switch (normalizeParentLinkStatus(status)) {
    case "pending_admin":
      return "pending";
    case "approved":
      return "approved";
    case "admin_rejected":
      return "rejected";
    default:
      return "not_started";
  }
}

export function approvalStepLabel(state: ApprovalStepState): string {
  if (state === "pending") return "Pending";
  if (state === "approved") return "Approved";
  if (state === "rejected") return "Rejected";
  return "Not yet";
}

/** Badge variant for shadcn <Badge>. */
export function parentLinkStatusBadgeVariant(status: unknown): "default" | "secondary" | "destructive" | "outline" {
  const s = normalizeParentLinkStatus(status);
  if (s === "approved") return "default";
  if (s === "rejected" || s === "admin_rejected") return "destructive";
  if (s === "pending_admin") return "outline";
  return "secondary";
}

/**
 * Why a parent may not sign in yet, or null when access is allowed.
 * `linkStatuses` should be ordered newest first.
 */
export function parentLoginBlockedMessage(
  accountStatus: string | null | undefined,
  linkStatuses: unknown[],
): string | null {
  const statuses = linkStatuses.map(normalizeParentLinkStatus);
  if (accountStatus === "approved" && statuses.includes("approved")) return null;
  if (accountStatus !== "approved" && accountStatus !== "pending" && accountStatus !== "rejected") return null;

  if (statuses.includes("pending_admin")) {
    return "The student approved your parent/guardian request. It is now waiting for administrator approval. You can sign in once an administrator approves it.";
  }
  if (statuses.includes("pending")) {
    return "Your parent/guardian request is waiting for the student to approve it. You can sign in after both the student and an administrator approve it.";
  }
  const latest = statuses[0];
  if (latest === "admin_rejected") {
    return "An administrator did not approve your parent/guardian request. Your account is not active. Contact the school administrator if you believe this is a mistake.";
  }
  if (latest === "rejected") {
    return "The student rejected your parent/guardian request. Your account is not active. Contact the school administrator if you believe this is a mistake.";
  }
  if (accountStatus === "pending") return "Account pending approval";
  if (accountStatus === "rejected") return "Account not approved";
  return "Your parent/guardian account has no approved student link yet. Contact the school administrator.";
}

/** Maps database error codes from parent-link RPCs and signup checks to user-facing text. */
export function parentLinkErrorMessage(rawMessage: string | null | undefined): string {
  const msg = (rawMessage ?? "").toLowerCase();
  if (msg.includes("student_not_found_for_guardian_link")) {
    return "No student account matches that Student ID. Check the Student ID and try again.";
  }
  if (msg.includes("student_id_required") || msg.includes("guardian_student_id_required")) {
    return "Please enter the student's Student ID.";
  }
  if (msg.includes("parent_email_mismatch")) {
    return "This email does not match the parent/guardian email registered by the student. A Student ID alone cannot request or approve parent access.";
  }
  if (msg.includes("parent_email_not_set")) {
    return "This student has not registered a parent/guardian email yet. Parent access cannot continue until that email is on the student account.";
  }
  if (msg.includes("parent_email_invalid")) {
    return "Enter a valid parent/guardian email address.";
  }
  if (msg.includes("parent_email_required")) {
    return "A parent/guardian Gmail address is required.";
  }
  if (msg.includes("parent_email_locked")) {
    return "The parent/guardian email was set during student registration and cannot be changed here.";
  }
  if (msg.includes("parent_email_already_registered")) {
    return "This email already has an account. If you have a parent account, please sign in. Otherwise contact an administrator.";
  }
  if (msg.includes("pending_request_exists")) {
    return "A request for this student is already pending approval.";
  }
  if (msg.includes("already_approved")) {
    return "You are already linked to this student.";
  }
  if (msg.includes("invalid_parent_student_link")) {
    return "You cannot link to your own account.";
  }
  if (msg.includes("account_not_active")) {
    return "Your parent account is not active yet.";
  }
  if (msg.includes("request_not_pending") || msg.includes("request_not_awaiting_admin")) {
    return "This request has already been decided. Refresh to see its current status.";
  }
  if (msg.includes("request_not_found")) {
    return "This request no longer exists.";
  }
  if (msg.includes("forbidden") || msg.includes("parent_role_required")) {
    return "You do not have permission to do that.";
  }
  if (msg.includes("parent_requires_verified_link")) {
    return "Parent accounts are activated by approving their Parent/Guardian request after the student approves it.";
  }
  return rawMessage?.trim() || "Something went wrong. Please try again.";
}
