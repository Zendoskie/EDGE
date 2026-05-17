export type ReferralStatus = "pending" | "approved" | "rejected";

export function normalizeReferralStatus(status: unknown): ReferralStatus {
  if (typeof status !== "string") return "pending";
  const s = status.trim().toLowerCase();
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  return "pending";
}

export function referralStatusLabel(status: ReferralStatus): string {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Pending";
}

export function referralStatusVariant(
  status: ReferralStatus,
): "default" | "secondary" | "destructive" {
  if (status === "approved") return "default";
  if (status === "rejected") return "destructive";
  return "secondary";
}
