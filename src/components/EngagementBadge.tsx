import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  canonicalEngagementLevel,
  engagementBadgeClassName,
  engagementLabel,
} from '@/lib/engagement-utils';

type EngagementBadgeProps = {
  level: unknown;
  score?: number | null;
  className?: string;
};

export function EngagementBadge({ level, score, className }: EngagementBadgeProps) {
  const canonical = canonicalEngagementLevel(level);
  const label = engagementLabel(canonical);
  const display =
    score != null && Number.isFinite(score) ? `${label} (${Math.round(score * 10) / 10})` : label;

  return (
    <Badge variant="outline" className={cn(engagementBadgeClassName(canonical), className)}>
      {display}
    </Badge>
  );
}
