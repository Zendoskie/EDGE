import { Badge } from "@/components/ui/badge";
import {
  normalizeReferralStatus,
  referralStatusLabel,
  referralStatusVariant,
  type ReferralStatus,
} from "@/lib/referral-utils";

export function ReferralStatusBadge({
  status,
  className,
}: {
  status: ReferralStatus | string | null | undefined;
  className?: string;
}) {
  const normalized = normalizeReferralStatus(status);
  return (
    <Badge variant={referralStatusVariant(normalized)} className={className}>
      {referralStatusLabel(normalized)}
    </Badge>
  );
}
