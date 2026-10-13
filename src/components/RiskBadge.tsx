import { Badge } from '@/components/ui/badge';
import { riskDisplayStatus, type RiskEvidenceRow } from '@/lib/risk-scoring';
import { cn } from '@/lib/utils';
import { riskBadgeClassName } from '@/lib/risk-utils';
import type { SubjectGradingWeights } from '@/lib/weighted-grading';

type RiskBadgeProps = {
  level: unknown;
  /** The stored prediction row, selected with PREDICTION_EVIDENCE_COLUMNS. Without it the status is unverified. */
  evidence?: RiskEvidenceRow | null;
  /** Subject weights; `null` = no saved row (defaults apply); omit when the view did not load them. */
  weights?: SubjectGradingWeights | null;
  className?: string;
};

export function RiskBadge({ level, evidence, weights, className }: RiskBadgeProps) {
  const status = riskDisplayStatus({ level, evidence, weights });

  return (
    <Badge
      variant="outline"
      title={status.description}
      className={cn(
        status.level ? riskBadgeClassName(status.level) : 'border-border bg-muted text-muted-foreground',
        className,
      )}
    >
      {status.label}
    </Badge>
  );
}
