import { HeartHandshake } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EngagementBadge } from '@/components/EngagementBadge';
import { EngagementScoreInfo } from '@/components/EngagementScoreInfo';
import { formatLastLogin } from '@/lib/engagement-format';
import { PARENT_ENGAGEMENT_CONFIG, type ParentEngagementSummary } from '@/lib/parent-engagement';
import { cn } from '@/lib/utils';

type Props = {
  variant: 'parent' | 'instructor';
  summary: ParentEngagementSummary | null;
  parentCount?: number;
  isLoading?: boolean;
  error?: Error | null;
  className?: string;
};

/**
 * Parent check-in engagement card.
 * Parent variant shows the signed-in parent's own score.
 * Instructor variant shows the student's most active linked parent.
 */
export function ParentEngagementCard({
  variant,
  summary,
  parentCount = 0,
  isLoading = false,
  error = null,
  className,
}: Props) {
  const title = variant === 'parent' ? 'Your check-in engagement' : 'Parent check-in engagement';
  const description =
    variant === 'parent'
      ? `How often you review this student's account. ${PARENT_ENGAGEMENT_CONFIG.targetCheckInsPerWeek} check-ins per week earns 100; repeats within ${PARENT_ENGAGEMENT_CONFIG.dedupeMinutes} minutes count once.`
      : `How often the linked parent reviews this student's account. ${PARENT_ENGAGEMENT_CONFIG.targetCheckInsPerWeek} check-ins per week earns 100.`;

  return (
    <Card className={cn('bg-card/90 border-border/70', className)}>
      <CardHeader className="space-y-1.5 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <HeartHandshake className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          <EngagementScoreInfo variant="parent" />
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="pt-1">
        {isLoading ? (
          <Skeleton className="h-9 w-40" />
        ) : error ? (
          <p className="text-sm text-muted-foreground">Check-in engagement is unavailable. {error.message}</p>
        ) : variant === 'instructor' && parentCount === 0 ? (
          <p className="text-sm text-muted-foreground">
            No linked parent account has checked in yet.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <EngagementBadge level={summary?.level ?? 'low'} score={summary?.score} />
              <span className="text-sm text-muted-foreground">
                Score{' '}
                <span className="font-semibold tabular-nums text-foreground">
                  {summary != null ? Math.round(summary.score * 10) / 10 : '—'}
                </span>
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg border p-2">
                <p className="text-[10px] text-muted-foreground">Check-ins (last {PARENT_ENGAGEMENT_CONFIG.windowDays} days)</p>
                <p className="text-lg font-semibold tabular-nums">{summary?.checkInCount ?? 0}</p>
              </div>
              <div className="rounded-lg border p-2">
                <p className="text-[10px] text-muted-foreground">Last check-in</p>
                <p className="text-xs font-medium leading-snug">{formatLastLogin(summary?.lastCheckInAt)}</p>
              </div>
            </div>
            {variant === 'instructor' && parentCount > 1 ? (
              <p className="text-xs text-muted-foreground">
                Showing the most active of {parentCount} linked parent accounts.
              </p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
