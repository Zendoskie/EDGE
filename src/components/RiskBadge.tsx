import { Badge } from '@/components/ui/badge';
import { formatOfficialRiskLabel } from '@/lib/risk-scoring';
import { cn } from '@/lib/utils';
import { canonicalRiskLevel, riskBadgeClassName } from '@/lib/risk-utils';

type RiskBadgeProps = {
  level: unknown;
  score?: number | null;
  className?: string;
};

export function RiskBadge({ level, score, className }: RiskBadgeProps) {
  const canonical = canonicalRiskLevel(level);
  const display = formatOfficialRiskLabel(level, score);

  return (
    <Badge variant="outline" className={cn(riskBadgeClassName(canonical), className)}>
      {display}
    </Badge>
  );
}
