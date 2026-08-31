export type ParentLinkStatus = "pending" | "approved" | "rejected";

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

export function parentLinkDecisionNotification(opts: {
  linkId: string;
  status: ParentLinkStatus;
  studentName: string;
  /** ISO timestamp of the request cycle; included in dedupeKey so re-request rejections fire again. */
  requestedAt?: string | null;
}): ParentLinkNotification | null {
  const studentName = opts.studentName.trim() || "the student";
  const cycle = opts.requestedAt ?? "";

  if (opts.status === "approved") {
    return {
      title: "Access request approved",
      body: `Your request to access ${studentName}'s academic information has been approved. You can now view their academic records.`,
      dedupeKey: `parent-link-approved:${opts.linkId}:${cycle}`,
      sourceName: studentName,
    };
  }

  if (opts.status === "rejected") {
    return {
      title: "Access request rejected",
      body: `Your request to access ${studentName}'s academic information has been rejected. You may submit a new request from your dashboard.`,
      dedupeKey: `parent-link-rejected:${opts.linkId}:${cycle}`,
      sourceName: studentName,
    };
  }

  return null;
}
export function normalizeParentLinkStatus(status: unknown): ParentLinkStatus {
  if (typeof status !== "string") return "pending";
  const s = status.trim().toLowerCase();
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  return "pending";
}
