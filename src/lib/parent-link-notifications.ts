export type ParentLinkStatus = "pending" | "approved" | "rejected";

export type ParentLinkNotification = {
  title: string;
  body: string;
  dedupeKey: string;
};

export function studentParentRequestNotification(opts: {
  linkId: string;
  parentName: string;
}): ParentLinkNotification {
  const parentName = opts.parentName.trim() || "A parent/guardian";
  return {
    title: "Parent access request",
    body: `${parentName} has requested permission to view your academic information. Open Settings to approve or reject.`,
    dedupeKey: `parent-link-request:${opts.linkId}:pending`,
  };
}

export function parentLinkDecisionNotification(opts: {
  linkId: string;
  status: ParentLinkStatus;
  studentName: string;
}): ParentLinkNotification | null {
  const studentName = opts.studentName.trim() || "the student";

  if (opts.status === "approved") {
    return {
      title: "Access request approved",
      body: `Your request to access ${studentName}'s academic information has been approved.`,
      dedupeKey: `parent-link-approved:${opts.linkId}`,
    };
  }

  if (opts.status === "rejected") {
    return {
      title: "Access request rejected",
      body: `Your request to access ${studentName}'s academic information has been rejected.`,
      dedupeKey: `parent-link-rejected:${opts.linkId}`,
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
