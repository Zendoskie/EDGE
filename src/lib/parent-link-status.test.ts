import { describe, expect, it } from "vitest";
import {
  adminApprovalState,
  normalizeParentLinkStatus,
  parentLinkErrorMessage,
  parentLinkStatusLabel,
  parentLoginBlockedMessage,
  studentApprovalState,
} from "./parent-link-status";
import { parentLinkDecisionNotification } from "./parent-link-notifications";

describe("normalizeParentLinkStatus", () => {
  it("keeps the two-step statuses", () => {
    expect(normalizeParentLinkStatus("pending_admin")).toBe("pending_admin");
    expect(normalizeParentLinkStatus("ADMIN_REJECTED")).toBe("admin_rejected");
    expect(normalizeParentLinkStatus("approved")).toBe("approved");
  });

  it("treats unknown values as pending (never as approved)", () => {
    expect(normalizeParentLinkStatus("active")).toBe("pending");
    expect(normalizeParentLinkStatus(undefined)).toBe("pending");
  });
});

describe("approval step states", () => {
  it.each([
    ["pending", "pending", "not_started"],
    ["pending_admin", "approved", "pending"],
    ["approved", "approved", "approved"],
    ["rejected", "rejected", "not_started"],
    ["admin_rejected", "approved", "rejected"],
  ])("%s -> student %s, admin %s", (status, student, admin) => {
    expect(studentApprovalState(status)).toBe(student);
    expect(adminApprovalState(status)).toBe(admin);
  });

  it("labels every status", () => {
    expect(parentLinkStatusLabel("pending")).toBe("Awaiting student approval");
    expect(parentLinkStatusLabel("pending_admin")).toBe("Awaiting admin approval");
    expect(parentLinkStatusLabel("approved")).toBe("Active");
    expect(parentLinkStatusLabel("rejected")).toBe("Rejected by student");
    expect(parentLinkStatusLabel("admin_rejected")).toBe("Rejected by admin");
  });
});

describe("parentLoginBlockedMessage", () => {
  it("allows an approved parent with an admin-approved link", () => {
    expect(parentLoginBlockedMessage("approved", ["pending", "approved"])).toBeNull();
  });

  it("blocks while waiting for the student", () => {
    expect(parentLoginBlockedMessage("pending", ["pending"])).toMatch(/waiting for the student/i);
  });

  it("blocks while waiting for an administrator", () => {
    expect(parentLoginBlockedMessage("pending", ["pending_admin"])).toMatch(/administrator approval/i);
  });

  it("blocks after a student rejection", () => {
    expect(parentLoginBlockedMessage("pending", ["rejected"])).toMatch(/student rejected/i);
  });

  it("blocks after an admin rejection", () => {
    expect(parentLoginBlockedMessage("rejected", ["admin_rejected"])).toMatch(/administrator did not approve/i);
  });

  it("blocks an approved account that has no approved link", () => {
    expect(parentLoginBlockedMessage("approved", [])).toMatch(/no approved student link/i);
  });

  it("defers other account states (e.g. deactivated) to the generic check", () => {
    expect(parentLoginBlockedMessage("deactivated", ["approved"])).toBeNull();
  });
});

describe("parentLinkErrorMessage", () => {
  it("explains an invalid Student ID without leaking data", () => {
    expect(parentLinkErrorMessage('new row violates: student_not_found_for_guardian_link')).toBe(
      "No student account matches that Student ID. Check the Student ID and try again.",
    );
  });

  it("maps duplicate and already-linked cases", () => {
    expect(parentLinkErrorMessage("pending_request_exists")).toMatch(/already pending/i);
    expect(parentLinkErrorMessage("already_approved")).toMatch(/already linked/i);
    expect(parentLinkErrorMessage("parent_email_already_registered")).toMatch(/already has an account/i);
  });
});

describe("parentLinkDecisionNotification", () => {
  it("tells the parent the student approved and an admin is next", () => {
    const n = parentLinkDecisionNotification({ linkId: "l1", status: "pending_admin", studentName: "Ana" });
    expect(n?.body).toMatch(/administrator approval/i);
  });

  it("does not claim access for any status from the realtime path", () => {
    expect(parentLinkDecisionNotification({ linkId: "l1", status: "approved", studentName: "Ana" })).toBeNull();
    expect(parentLinkDecisionNotification({ linkId: "l1", status: "pending", studentName: "Ana" })).toBeNull();
  });
});
