import { normalizeParentLinkStatus, type ParentLinkStatus } from "@/lib/parent-link-status";

export { normalizeParentLinkStatus, type ParentLinkStatus };

export type ParentLinkNotification = {
  title: string;
  body: string;
  dedupeKey: string;
  sourceName: string;
};

export function studentParentRequestNotification(opts: {
  linkId: string;
  parentName: string;
}): ParentLinkNotification {
  return {
    title: "Parent Access Request",
    body: `${opts.parentName} is requesting access to your academic records. Open Parent Access Requests to approve or reject.`,
    dedupeKey: `parent-link-request:${opts.linkId}:pending`,
    sourceName: opts.parentName.trim() || "Parent/Guardian",
  };
}

/**
 * In-app notice for a parent who is already signed in (an active parent requesting
 * another student). Admin decisions are delivered through the durable inbox instead.
 */
export function parentLinkDecisionNotification(opts: {
  linkId: string;
  status: ParentLinkStatus;
  studentName: string;
  /** ISO timestamp of the request cycle; included in dedupeKey so re-request rejections fire again. */
  requestedAt?: string | null;
}): ParentLinkNotification | null {
  const studentName = opts.studentName.trim() || "the student";
  const cycle = opts.requestedAt ?? "";

  if (opts.status === "pending_admin") {
    return {
      title: "Student approved your request",
      body: `${studentName} approved your request. It is now waiting for administrator approval before you can view their academic records.`,
      dedupeKey: `parent-link-student-approved:${opts.linkId}:${cycle}`,
      sourceName: studentName,
    };
  }

  if (opts.status === "rejected") {
    return {
      title: "Access request rejected",
      body: `${studentName} rejected your request to access their academic information.`,
      dedupeKey: `parent-link-rejected:${opts.linkId}:${cycle}`,
      sourceName: studentName,
    };
  }

  return null;
}
