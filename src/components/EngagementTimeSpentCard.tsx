import { useState } from 'react';
import { Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useStudentTimeSpent } from '@/hooks/useStudentTimeSpent';
import { formatTimeSpentDetailed } from '@/lib/engagement-format';
import {
  DEFAULT_TIME_SPENT_PERIOD,
  TIME_SPENT_PERIODS,
  timeSpentForPeriod,
  timeSpentPeriodLabel,
  type TimeSpentPeriod,
} from '@/lib/engagement-periods';
import { cn } from '@/lib/utils';

type Props = {
  studentId: string | undefined | null;
  title?: string;
  description?: string;
  className?: string;
  defaultPeriod?: TimeSpentPeriod;
};

/**
 * Student time spent with a Today / Yesterday / This week / This month filter.
 *
 * Only measured active time is shown (the database credits heartbeats while the
 * tab is visible and the student is interacting), so a session that continues
 * across the day does not inflate earlier days.
 */
export function EngagementTimeSpentCard({
  studentId,
  title = 'Time spent',
  description = 'Measured active time in EDGE. Time is counted only while the tab is visible and the student is interacting.',
  className,
  defaultPeriod = DEFAULT_TIME_SPENT_PERIOD,
}: Props) {
  const [period, setPeriod] = useState<TimeSpentPeriod>(defaultPeriod);
  const { timeSpent, isLoading, error } = useStudentTimeSpent(studentId);

  const seconds = timeSpentForPeriod(timeSpent, period);

  return (
    <Card className={cn('bg-card/90 border-border/70', className)}>
      <CardHeader className="space-y-2 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          <Select value={period} onValueChange={(value) => setPeriod(value as TimeSpentPeriod)}>
            <SelectTrigger className="h-8 w-[140px] text-xs" aria-label="Time spent period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_SPENT_PERIODS.map((option) => (
                <SelectItem key={option.value} value={option.value} className="text-xs">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="pt-1">
        {isLoading ? (
          <Skeleton className="h-9 w-40" />
        ) : error ? (
          <p className="text-sm text-muted-foreground">
            Time spent is unavailable. {error.message}
          </p>
        ) : (
          <div className="space-y-1">
            <p className="text-2xl font-semibold leading-tight tabular-nums">
              {formatTimeSpentDetailed(seconds)}
            </p>
            <p className="text-xs text-muted-foreground">
              {timeSpentPeriodLabel(period)}
              {period === 'week' || period === 'month' ? ' so far' : ''} · idle or hidden tab time is
              not counted
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
