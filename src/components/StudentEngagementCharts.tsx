import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { InsightsChartFrame } from '@/components/insights/InsightsChartFrame';
import { useStudentEngagementCharts } from '@/hooks/useStudentEngagementCharts';
import { TrendingUp, GitCompareArrows } from 'lucide-react';
import type { TrendGranularity } from '@/lib/engagement-trend';

type Props = {
  studentId: string;
  /** Optional subject scope for risk predictions (instructor subjects). */
  subjectIds?: string[];
};

const CHART_H = 'h-[260px] w-full min-w-0';

export function StudentEngagementCharts({ studentId, subjectIds }: Props) {
  const { series, granularity, setGranularity, isLoading, error, isFetching } =
    useStudentEngagementCharts(studentId, subjectIds);

  const periodLabel = granularity === 'week' ? 'Week' : 'Month';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Live engagement trends reconstructed from login, activity, and risk prediction history.
          {isFetching && !isLoading ? (
            <span className="ml-2 text-xs text-primary">Refreshing…</span>
          ) : null}
        </p>
        <div className="flex gap-1">
          {(['week', 'month'] as TrendGranularity[]).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={granularity === value ? 'default' : 'outline'}
              className="h-8"
              onClick={() => setGranularity(value)}
            >
              {value === 'week' ? 'Week' : 'Month'}
            </Button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive">Could not load charts. {error.message}</p>
      ) : null}

      <Card className="bg-card/90 border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Engagement Trend
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            X-axis = {periodLabel} · Y-axis = Engagement Score (0–100)
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[260px] w-full" />
          ) : (
            <InsightsChartFrame minWidth={320}>
              <div className={CHART_H}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={36} />
                    <Tooltip
                      formatter={(value: number) => [value, 'Engagement Score']}
                      labelFormatter={(label) => `${periodLabel}: ${label}`}
                    />
                    <Line
                      type="monotone"
                      dataKey="engagementScore"
                      name="Engagement Score"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </InsightsChartFrame>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/90 border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <GitCompareArrows className="h-4 w-4 text-primary" />
            Engagement vs Risk Score
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Engagement Score and Risk Score on the same {periodLabel.toLowerCase()} timeline.
            Risk values come from stored predictions (AI Risk Analysis is not modified).
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[260px] w-full" />
          ) : (
            <InsightsChartFrame minWidth={320}>
              <div className={CHART_H}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={36} />
                    <Tooltip
                      formatter={(value: number, name: string) => [value, name]}
                      labelFormatter={(label) => `${periodLabel}: ${label}`}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="engagementScore"
                      name="Engagement Score"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="riskScore"
                      name="Risk Score"
                      stroke="hsl(0 72% 51%)"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      dot={{ r: 3 }}
                      connectNulls
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </InsightsChartFrame>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
