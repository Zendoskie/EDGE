import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { canonicalRiskLevel, riskBadgeClassName, riskLabel } from '@/lib/risk-utils';

type RiskBadgeProps = {
  level: unknown;
  score?: number | null;
  className?: string;
};

export function RiskBadge({ level, score, className }: RiskBadgeProps) {
  const canonical = canonicalRiskLevel(level);
  const label = riskLabel(canonical);
  const display =
    score != null && Number.isFinite(score) ? `${label} (${Math.round(score * 10) / 10})` : label;

  return (
    <Badge variant="outline" className={cn(riskBadgeClassName(canonical), className)}>
      {display}
    </Badge>
  );
}
