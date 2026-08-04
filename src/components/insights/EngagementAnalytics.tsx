import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from '@/components/ui/chart';
import { Bar, BarChart, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis, CartesianGrid } from 'recharts';
import { InsightsChartFrame } from '@/components/insights/InsightsChartFrame';
import {
  ENGAGEMENT_LEVEL_ORDER,
  canonicalEngagementLevel,
  engagementChartColor,
  engagementLabel,
} from '@/lib/engagement-utils';
import { Activity, LogIn } from 'lucide-react';

const CHART_H_MD = 'h-[280px] w-full min-w-0';
const CHART_MARGIN = { top: 8, right: 8, left: 8, bottom: 8 };

type Props = {
  instructorId: string;
};

export function EngagementAnalytics({ instructorId }: Props) {
  const { data: subjects = [] } = useQuery({
    queryKey: ['engagement-analytics-subjects', instructorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subjects')
        .select('id, code')
        .eq('instructor_id', instructorId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!instructorId,
  });

  const subjectIds = useMemo(() => subjects.map((s) => s.id).filter(Boolean) as string[], [subjects]);
  const codeById = useMemo(() => new Map(subjects.map((s) => [s.id, s.code])), [subjects]);

  const { data: studentIds = [] } = useQuery({
    queryKey: ['engagement-analytics-students', subjectIds.join(',')],
    queryFn: async () => {
      if (subjectIds.length === 0) return [];
      const { data, error } = await supabase
        .from('enrollments')
        .select('student_id')
        .in('subject_id', subjectIds)
        .eq('status', 'active');
      if (error) throw error;
      return [...new Set((data ?? []).map((e) => e.student_id).filter(Boolean))] as string[];
    },
    enabled: subjectIds.length > 0,
  });

  const { data: summaries = [], isLoading } = useQuery({
    queryKey: ['engagement-analytics-summaries', studentIds.join(',')],
    queryFn: async () => {
      if (studentIds.length === 0) return [];
      const { data, error } = await supabase
        .from('student_engagement_summary')
        .select('*')
        .in('student_id', studentIds);
      if (error) throw error;
      return data ?? [];
    },
    enabled: studentIds.length > 0,
  });

  const { data: loginHistory = [] } = useQuery({
    queryKey: ['engagement-analytics-logins', studentIds.join(',')],
    queryFn: async () => {
      if (studentIds.length === 0) return [];
      const since = new Date();
      since.setDate(since.getDate() - 56);
      const { data, error } = await supabase
        .from('student_login_history')
        .select('login_time, student_id')
        .in('student_id', studentIds)
        .gte('login_time', since.toISOString());
      if (error) throw error;
      return data ?? [];
    },
    enabled: studentIds.length > 0,
  });

  const { data: activities = [] } = useQuery({
    queryKey: ['engagement-analytics-activities', subjectIds.join(',')],
    queryFn: async () => {
      if (subjectIds.length === 0) return [];
      const since = new Date();
      since.setDate(since.getDate() - 56);
      const { data, error } = await supabase
        .from('student_activity')
        .select('created_at, subject_id')
        .in('subject_id', subjectIds)
        .gte('created_at', since.toISOString());
      if (error) throw error;
      return data ?? [];
    },
    enabled: subjectIds.length > 0,
  });

  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = {
      very_high: 0,
      high: 0,
      moderate: 0,
      low: 0,
    };
    for (const s of summaries) {
      const level = canonicalEngagementLevel(s.engagement_level);
      counts[level] = (counts[level] ?? 0) + 1;
    }
    return counts;
  }, [summaries]);

  const distributionData = ENGAGEMENT_LEVEL_ORDER.map((level) => ({
    level,
    name: engagementLabel(level),
    value: levelCounts[level] ?? 0,
    fill: engagementChartColor(level),
  }));

  const dailyLogins = useMemo(() => {
    const byDay = new Map<string, number>();
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      byDay.set(d.toISOString().slice(0, 10), 0);
    }
    for (const row of loginHistory) {
      const day = String(row.login_time).slice(0, 10);
      if (byDay.has(day)) byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    return Array.from(byDay.entries()).map(([date, count]) => ({
      date: date.slice(5),
      count,
    }));
  }, [loginHistory]);

  const weeklyLogins = useMemo(() => {
    const weeks: Array<{ week: string; count: number }> = [];
    for (let w = 7; w >= 0; w--) {
      const start = new Date();
      start.setDate(start.getDate() - w * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      const label = `W${8 - w}`;
      let count = 0;
      for (const row of loginHistory) {
        const t = Date.parse(String(row.login_time));
        if (t >= start.getTime() && t <= end.getTime() + 86400000) count++;
      }
      weeks.push({ week: label, count });
    }
    return weeks;
  }, [loginHistory]);

  const subjectActivityCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of activities) {
      const sid = row.subject_id as string;
      if (!sid) continue;
      counts.set(sid, (counts.get(sid) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([id, count]) => ({ code: codeById.get(id) ?? id.slice(0, 8), count }))
      .sort((a, b) => b.count - a.count);
  }, [activities, codeById]);

  const weeklyParticipation = useMemo(() => {
    const weeks: Array<{ week: string; count: number }> = [];
    for (let w = 7; w >= 0; w--) {
      const start = new Date();
      start.setDate(start.getDate() - w * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      const label = `W${8 - w}`;
      let count = 0;
      for (const row of activities) {
        const t = Date.parse(String(row.created_at));
        if (t >= start.getTime() && t <= end.getTime() + 86400000) count++;
      }
      weeks.push({ week: label, count });
    }
    return weeks;
  }, [activities]);

  const chartConfig = {
    count: { label: 'Count', color: 'hsl(var(--primary))' },
    very_high: { label: 'Highly Active', color: engagementChartColor('very_high') },
    high: { label: 'Active', color: engagementChartColor('high') },
    moderate: { label: 'Low Engagement', color: engagementChartColor('moderate') },
    low: { label: 'Inactive', color: engagementChartColor('low') },
  };

  if (subjectIds.length === 0) {
    return (
      <Card className="bg-card/90">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Create subjects and enroll students to see engagement analytics.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Student Engagement Analytics
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Engagement levels and activity patterns across your enrolled students.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {ENGAGEMENT_LEVEL_ORDER.map((level) => (
          <Card key={level} className="bg-card/90">
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">{engagementLabel(level)}</p>
              <p className="text-2xl font-bold tabular-nums">{levelCounts[level] ?? 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card/90 min-w-0">
          <CardHeader>
            <CardTitle className="text-base">Engagement level distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : summaries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No engagement summaries yet.</p>
            ) : (
              <InsightsChartFrame>
                <ChartContainer config={chartConfig} className={CHART_H_MD}>
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Pie data={distributionData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}>
                      {distributionData.map((entry) => (
                        <Cell key={entry.level} fill={entry.fill} />
                      ))}
                    </Pie>
                    <ChartLegend content={<ChartLegendContent />} />
                  </PieChart>
                </ChartContainer>
              </InsightsChartFrame>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/90 min-w-0">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <LogIn className="h-4 w-4" />
              Daily login activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <InsightsChartFrame>
              <ChartContainer config={chartConfig} className={CHART_H_MD}>
                <BarChart data={dailyLogins} margin={CHART_MARGIN}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" fill="var(--color-count)" radius={4} name="Logins" />
                </BarChart>
              </ChartContainer>
            </InsightsChartFrame>
          </CardContent>
        </Card>

        <Card className="bg-card/90 min-w-0">
          <CardHeader>
            <CardTitle className="text-base">Weekly login trends</CardTitle>
          </CardHeader>
          <CardContent>
            <InsightsChartFrame>
              <ChartContainer config={chartConfig} className={CHART_H_MD}>
                <LineChart data={weeklyLogins} margin={CHART_MARGIN}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="week" tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="count" stroke="var(--color-count)" strokeWidth={2} dot={{ r: 3 }} name="Logins" />
                </LineChart>
              </ChartContainer>
            </InsightsChartFrame>
          </CardContent>
        </Card>

        <Card className="bg-card/90 min-w-0">
          <CardHeader>
            <CardTitle className="text-base">Student participation trends</CardTitle>
          </CardHeader>
          <CardContent>
            <InsightsChartFrame>
              <ChartContainer config={chartConfig} className={CHART_H_MD}>
                <LineChart data={weeklyParticipation} margin={CHART_MARGIN}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="week" tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="count" stroke="var(--color-count)" strokeWidth={2} dot={{ r: 3 }} name="Activities" />
                </LineChart>
              </ChartContainer>
            </InsightsChartFrame>
          </CardContent>
        </Card>

        <Card className="bg-card/90 min-w-0">
          <CardHeader>
            <CardTitle className="text-base">Most active subjects</CardTitle>
          </CardHeader>
          <CardContent>
            {subjectActivityCounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
            ) : (
              <InsightsChartFrame>
                <ChartContainer config={chartConfig} className={CHART_H_MD}>
                  <BarChart
                    data={subjectActivityCounts.slice(0, 8)}
                    layout="vertical"
                    margin={{ top: 8, right: 8, left: 48, bottom: 8 }}
                  >
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="code" tickLine={false} axisLine={false} width={44} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={4} name="Activities" />
                  </BarChart>
                </ChartContainer>
              </InsightsChartFrame>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/90 min-w-0">
          <CardHeader>
            <CardTitle className="text-base">Least active subjects</CardTitle>
          </CardHeader>
          <CardContent>
            {subjectActivityCounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
            ) : (
              <InsightsChartFrame>
                <ChartContainer config={chartConfig} className={CHART_H_MD}>
                  <BarChart
                    data={[...subjectActivityCounts].reverse().slice(0, 8)}
                    layout="vertical"
                    margin={{ top: 8, right: 8, left: 48, bottom: 8 }}
                  >
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="code" tickLine={false} axisLine={false} width={44} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill={engagementChartColor('moderate')} radius={4} name="Activities" />
                  </BarChart>
                </ChartContainer>
              </InsightsChartFrame>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
