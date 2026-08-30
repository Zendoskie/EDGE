import { Navigate } from 'react-router-dom';
import {
  Activity,
  Download,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  Users,
  UserX,
  TrendingUp,
  Award,
  AlertTriangle,
  ClipboardCheck,
  Clock3,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useAdminEngagementAnalytics } from '@/hooks/useAdminEngagementAnalytics';
import {
  exportEngagementAnalyticsToExcel,
  exportEngagementAnalyticsToPdf,
} from '@/lib/engagement-export';
import { EngagementBadge } from '@/components/EngagementBadge';
import { InsightsChartFrame } from '@/components/insights/InsightsChartFrame';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { formatLastLogin, formatTimeSpent } from '@/lib/engagement-format';
import {
  engagementInterventionActionLabel,
  formatSignedDelta,
} from '@/lib/engagement-alerts';

const ACTIVE_COLOR = 'hsl(142 76% 36%)';
const INACTIVE_COLOR = 'hsl(0 72% 51%)';
const CHART_H = 'h-[280px] w-full min-w-0';

function StudentMiniTable({
  title,
  description,
  icon: Icon,
  rows,
  empty,
}: {
  title: string;
  description: string;
  icon: typeof Users;
  rows: {
    student_id: string;
    full_name: string;
    program_name: string;
    engagement_level: string;
    engagement_score: number;
    last_login_at: string | null;
    total_login_count: number;
  }[];
  empty: string;
}) {
  return (
    <Card className="bg-card/90 border-border/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {rows.map((row) => (
              <div
                key={row.student_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{row.full_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.program_name} · {row.total_login_count} logins ·{' '}
                    {formatLastLogin(row.last_login_at)}
                  </p>
                </div>
                <EngagementBadge level={row.engagement_level} score={row.engagement_score} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminEngagementAnalytics() {
  const { role } = useAuth();
  const { data, exportRows, isLoading, error, refetch } = useAdminEngagementAnalytics(
    role === 'admin',
  );

  if (role && role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  const handleExcel = () => {
    try {
      exportEngagementAnalyticsToExcel(exportRows);
      toast.success('Excel export downloaded');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Excel export failed');
    }
  };

  const handlePdf = () => {
    try {
      const active = data?.activeInactive.find((x) => x.key === 'active')?.value ?? 0;
      const inactive = data?.activeInactive.find((x) => x.key === 'inactive')?.value ?? 0;
      exportEngagementAnalyticsToPdf(exportRows, [
        `Generated: ${new Date().toLocaleString()}`,
        `Students: ${data?.rows.length ?? 0} · Active: ${active} · Inactive: ${inactive}`,
        `No activity (7+ days): ${data?.noActivity.length ?? 0}`,
      ]);
      toast.success('PDF export downloaded');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'PDF export failed');
    }
  };

  return (
    <div className="space-y-6 page-section">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            Engagement Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Campus-wide live engagement overview for administrators.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Refresh
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={handlePdf} disabled={!data}>
            <FileText className="h-4 w-4 mr-1.5" />
            Export PDF
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={handleExcel} disabled={!data}>
            <FileSpreadsheet className="h-4 w-4 mr-1.5" />
            Export Excel
          </Button>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive">Could not load analytics. {error.message}</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Students</p>
            <p className="text-2xl font-semibold tabular-nums">
              {isLoading ? '—' : data?.rows.length ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Active</p>
            <p className="text-2xl font-semibold tabular-nums text-emerald-600">
              {isLoading
                ? '—'
                : data?.activeInactive.find((x) => x.key === 'active')?.value ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Inactive / Low</p>
            <p className="text-2xl font-semibold tabular-nums text-destructive">
              {isLoading
                ? '—'
                : data?.activeInactive.find((x) => x.key === 'inactive')?.value ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Download className="h-3.5 w-3.5" />
              No Activity (7+ days)
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {isLoading ? '—' : data?.noActivity.length ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-card/90 border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Active vs Inactive Students
            </CardTitle>
            <CardDescription>Active = Highly Active / Active · Inactive = Low Engagement / Inactive</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[280px] w-full" />
            ) : (
              <InsightsChartFrame minWidth={280}>
                <div className={CHART_H}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data?.activeInactive ?? []}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        label
                      >
                        {(data?.activeInactive ?? []).map((entry) => (
                          <Cell
                            key={entry.key}
                            fill={entry.key === 'active' ? ACTIVE_COLOR : INACTIVE_COLOR}
                          />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </InsightsChartFrame>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/90 border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Award className="h-4 w-4 text-primary" />
              Average Engagement by Program
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[280px] w-full" />
            ) : (data?.byProgram.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No program engagement data yet.</p>
            ) : (
              <InsightsChartFrame minWidth={320}>
                <div className={CHART_H}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data?.byProgram ?? []} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                      <XAxis dataKey="program" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={50} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="avgScore" name="Avg Score" fill="hsl(221 76% 48%)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </InsightsChartFrame>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/90 border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Engagement Trend by Month
          </CardTitle>
          <CardDescription>
            Live monthly logins and average engagement score of students who logged in that month.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[280px] w-full" />
          ) : (
            <InsightsChartFrame minWidth={420}>
              <div className={CHART_H}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data?.monthlyTrend ?? []} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="score" domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="logins" orientation="right" tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Line
                      yAxisId="score"
                      type="monotone"
                      dataKey="avgScore"
                      name="Avg Score"
                      stroke="hsl(221 76% 48%)"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      yAxisId="logins"
                      type="monotone"
                      dataKey="logins"
                      name="Logins"
                      stroke="hsl(38 92% 50%)"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </InsightsChartFrame>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/90 border-border/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            Intervention Effectiveness
          </CardTitle>
          <CardDescription>
            Closed-loop completion and measured engagement outcomes. Staff assessments are
            reported separately from the AI risk model.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-36 w-full" />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Open follow-ups</p>
                  <p className="text-2xl font-semibold tabular-nums">
                    {data?.interventionEffectiveness.open ?? 0}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock3 className="h-3.5 w-3.5" />
                    Due now
                  </p>
                  <p className="text-2xl font-semibold tabular-nums text-amber-600">
                    {data?.interventionEffectiveness.due ?? 0}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Completion rate</p>
                  <p className="text-2xl font-semibold tabular-nums">
                    {data?.interventionEffectiveness.completionRate ?? 0}%
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Average engagement change</p>
                  <p className="text-2xl font-semibold tabular-nums">
                    {formatSignedDelta(
                      data?.interventionEffectiveness.averageEngagementDelta ?? null,
                      ' pts',
                    )}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="outline">
                  {data?.interventionEffectiveness.total ?? 0} total interventions
                </Badge>
                <Badge variant="outline">
                  {data?.interventionEffectiveness.completed ?? 0} completed
                </Badge>
                <Badge variant="outline">
                  {data?.interventionEffectiveness.improved ?? 0} assessed improved
                </Badge>
                <Badge variant="outline">
                  Avg. completion:{' '}
                  {data?.interventionEffectiveness.averageDaysToOutcome != null
                    ? `${data.interventionEffectiveness.averageDaysToOutcome} days`
                    : '—'}
                </Badge>
              </div>

              {(data?.interventionEffectiveness.byAction.length ?? 0) > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-border/60">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30 text-left text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Action</th>
                        <th className="px-3 py-2 text-right font-medium">Total</th>
                        <th className="px-3 py-2 text-right font-medium">Completed</th>
                        <th className="px-3 py-2 text-right font-medium">Improved</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.interventionEffectiveness.byAction ?? []).map((row) => (
                        <tr key={row.actionType} className="border-b border-border/40">
                          <td className="px-3 py-2 font-medium">
                            {engagementInterventionActionLabel(row.actionType)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.total}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.completed}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.improved}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No closed-loop intervention outcomes have been recorded yet.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <StudentMiniTable
          title="Students with No Activity"
          description="No login recorded, or last login older than 7 days."
          icon={UserX}
          rows={isLoading ? [] : data?.noActivity.slice(0, 12) ?? []}
          empty="All students have recent activity."
        />
        <StudentMiniTable
          title="Most Active Students"
          description="Highest engagement scores across campus."
          icon={Award}
          rows={isLoading ? [] : data?.mostActive ?? []}
          empty="No student engagement data yet."
        />
        <StudentMiniTable
          title="Lowest Engagement Students"
          description="Lowest engagement scores — follow up recommended."
          icon={AlertTriangle}
          rows={isLoading ? [] : data?.lowestEngagement ?? []}
          empty="No student engagement data yet."
        />
      </div>

      <Card className="bg-card/90 border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">All Students (live)</CardTitle>
          <CardDescription>
            {data ? `${data.rows.length} students · export includes full detail` : 'Loading…'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Student</th>
                    <th className="py-2 pr-3 font-medium">Program</th>
                    <th className="py-2 pr-3 font-medium">Level</th>
                    <th className="py-2 pr-3 font-medium">Score</th>
                    <th className="py-2 pr-3 font-medium">Logins</th>
                    <th className="py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 font-medium">Last Login</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.rows ?? []).map((row) => (
                    <tr key={row.student_id} className="border-b border-border/40">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{row.full_name}</div>
                        <div className="text-xs text-muted-foreground">{row.email}</div>
                      </td>
                      <td className="py-2 pr-3">{row.program_name}</td>
                      <td className="py-2 pr-3">
                        <EngagementBadge level={row.engagement_level} />
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{row.engagement_score}</td>
                      <td className="py-2 pr-3 tabular-nums">{row.total_login_count}</td>
                      <td className="py-2 pr-3">{formatTimeSpent(row.total_time_spent_seconds)}</td>
                      <td className="py-2">{formatLastLogin(row.last_login_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(data?.rows.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground py-6">No students found.</p>
              ) : null}
            </div>
          )}
          {isLoading ? null : (
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="outline">{data?.rows.length ?? 0} rows ready for export</Badge>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
