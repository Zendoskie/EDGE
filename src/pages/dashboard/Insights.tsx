import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { 
  Brain, 
  MessageSquare, 
  BarChart3, 
  TrendingUp, 
  TrendingDown,
  Target,
  Calendar,
  Award,
  Clock,
  BookOpen,
  Activity,
  Sparkles
} from 'lucide-react';
import { CanonicalRiskLevel, canonicalRiskLevel, riskLabel, riskVariant } from '@/lib/risk-utils';
import { invokeAiCoach } from '@/lib/invoke-ai-coach';
import { FormattedAssistantContent } from '@/components/FormattedAssistantContent';

const RISK_LEVEL_ORDER: CanonicalRiskLevel[] = ['critical', 'at_risk', 'stable', 'excelling'];

/** Recharts / ChartContainer colors — aligned with semantic risk levels (readable in light & dark) */
const riskChartConfig = {
  critical: { label: 'Critical', theme: { light: 'hsl(0 72% 51%)', dark: 'hsl(0 72% 58%)' } },
  at_risk: { label: 'At Risk', theme: { light: 'hsl(38 92% 50%)', dark: 'hsl(38 92% 56%)' } },
  stable: { label: 'Stable', theme: { light: 'hsl(215 16% 42%)', dark: 'hsl(215 16% 68%)' } },
  excelling: { label: 'Excelling', theme: { light: 'hsl(142 76% 36%)', dark: 'hsl(142 68% 48%)' } },
} satisfies ChartConfig;

const metricsChartConfig = {
  value: { label: 'Percent', theme: { light: 'hsl(221 76% 48%)', dark: 'hsl(217 91% 65%)' } },
} satisfies ChartConfig;

const countChartConfig = {
  count: { label: 'Count', theme: { light: 'hsl(221 76% 48%)', dark: 'hsl(217 91% 65%)' } },
} satisfies ChartConfig;

const subjectScoreChartConfig = {
  avg: { label: 'Avg score %', theme: { light: 'hsl(221 76% 48%)', dark: 'hsl(217 91% 65%)' } },
} satisfies ChartConfig;

const scoreTrendChartConfig = {
  scorePct: { label: 'Score %', theme: { light: 'hsl(221 76% 48%)', dark: 'hsl(217 91% 65%)' } },
} satisfies ChartConfig;

const predictionTimelineChartConfig = {
  count: { label: 'Predictions', theme: { light: 'hsl(221 76% 48%)', dark: 'hsl(217 91% 65%)' } },
} satisfies ChartConfig;

const enrollmentChartConfig = {
  students: { label: 'Active students', theme: { light: 'hsl(221 76% 48%)', dark: 'hsl(217 91% 65%)' } },
} satisfies ChartConfig;

const concernChartConfig = {
  concern: { label: 'Students (critical / at-risk)', theme: { light: 'hsl(0 72% 51%)', dark: 'hsl(0 72% 58%)' } },
} satisfies ChartConfig;

interface Prediction {
  id: string;
  risk_level: string;
  recommendation?: string;
  created_at: string;
  subject_id: string;
  subjects?: {
    code: string;
    name: string;
  };
}

interface Intervention {
  id: string;
  type: string;
  message?: string;
  sent_at?: string;
  subject_id: string;
  subjects?: {
    code: string;
    name: string;
  };
}

interface Subject {
  id: string;
  code: string;
  name: string;
}

interface StudentStats {
  enrolledSubjects: number;
  attendanceRate: string;
  overallAverage: string;
  riskStatus: string;
  riskLevel: string | null;
  recommendation: string | null;
  subjectLabel: string | null;
}

/**
 * PostgREST may return `activities` as an object or a single-element array depending on the query.
 * Match StudentDashboard logic: resolve max_score and subject_id reliably.
 */
function getActivityFromSubmission(sub: any): { max_score?: number; subject_id?: string | null } | null {
  const a = sub?.activities;
  if (a == null) return null;
  if (Array.isArray(a)) return a[0] ?? null;
  return a;
}

function submissionScorePercent(sub: any): number | null {
  const raw = sub?.score;
  if (raw === null || raw === undefined) return null;
  const scoreNum = Number(raw);
  if (Number.isNaN(scoreNum)) return null;
  const act = getActivityFromSubmission(sub);
  const maxRaw = act?.max_score;
  const max = maxRaw != null && Number(maxRaw) > 0 ? Number(maxRaw) : 100;
  return (scoreNum / max) * 100;
}

/** Prefer graded_at; fall back to submitted_at so trends show when instructors didn’t set graded_at */
function submissionTrendDateIsoDay(sub: any): string | null {
  const t = sub?.graded_at || sub?.submitted_at;
  if (!t) return null;
  try {
    return new Date(t).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card className="bg-card/90">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}

export default function Insights() {
  const { user, role } = useAuth();

  if (!user?.id) {
    return (
      <div className="space-y-6 animate-fade-in">
        <section className="page-section overflow-hidden">
          <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
            <h1 className="text-2xl font-display font-bold">Performance Insights</h1>
          </div>
        </section>
        <EmptyState
          title="Sign in required"
          body="Please sign in to view performance insights."
        />
      </div>
    );
  }

  if (role === 'instructor') {
    return <InstructorInsights instructorId={user.id} />;
  }
  return <StudentInsights userId={user.id} />;
}

function StudentInsights({ userId }: { userId: string }) {
  const { data: predictions = [], isLoading: predictionsLoading, isError: predictionsIsError } = useQuery({
    queryKey: ['my-predictions', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('predictions')
        .select('*, subjects(id, code, name)')
        .eq('student_id', userId)
        .order('created_at', { ascending: false });
      if (error) {
        console.warn('Insights: predictions query failed', error);
        return [];
      }
      return data ?? [];
    },
    enabled: !!userId,
  });

  const { data: aiInsight, isLoading: aiInsightLoading } = useQuery({
    queryKey: ['ai-insight-summary', userId],
    enabled: !!userId,
    queryFn: async () => {
      const data = (await invokeAiCoach({ mode: 'predictions_insight' })) as { insight?: unknown };
      return typeof data?.insight === 'string' && data.insight.trim() ? data.insight : null;
    },
  });

  const { data: interventions = [], isLoading: interventionsLoading, isError: interventionsIsError } = useQuery({
    queryKey: ['my-interventions', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('interventions')
        .select('id, type, message, sent_at, subject_id, subjects(code, name)')
        .eq('student_id', userId)
        .order('sent_at', { ascending: false })
        .limit(10);
      if (error) {
        console.warn('Insights: interventions query failed', error);
        return [];
      }
      return data ?? [];
    },
    enabled: !!userId,
  });

  const { data: subjects = [], isLoading: subjectsLoading, isError: subjectsIsError } = useQuery({
    queryKey: ['my-subjects', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enrollments')
        .select('subjects(id, code, name)')
        .eq('student_id', userId)
        .eq('status', 'active');
      if (error) {
        console.warn('Insights: subjects query failed', error);
        return [];
      }
      return (data ?? []).map((e: { subjects: unknown }) => (e as { subjects: any }).subjects).filter(Boolean) ?? [];
    },
    enabled: !!userId,
  });

  const { data: attendance = [], isLoading: attendanceLoading, isError: attendanceIsError } = useQuery({
    queryKey: ['my-attendance-stats', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attendance')
        .select('status, subject_id')
        .eq('student_id', userId);
      if (error) {
        console.warn('Insights: attendance query failed', error);
        return [];
      }
      return data ?? [];
    },
    enabled: !!userId,
  });

  const { data: scores = [], isLoading: scoresLoading, isError: scoresIsError } = useQuery({
    queryKey: ['my-scores-stats', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('submissions')
        .select('score, graded_at, submitted_at, activity_id, activities(max_score, subject_id)')
        .eq('student_id', userId);
      if (error) {
        console.warn('Insights: scores query failed', error);
        return [];
      }
      return data ?? [];
    },
    enabled: !!userId,
  });

  const latestBySubject = useMemo(() => {
    return predictions.reduce((acc: Record<string, any>, p: any) => {
      const sid = p.subject_id;
      if (!sid) return acc;
      if (!acc[sid] || new Date(p.created_at) > new Date(acc[sid].created_at)) acc[sid] = p;
      return acc;
    }, {});
  }, [predictions]);

  const latestOverall = predictions.length > 0 ? predictions[0] : null;

  /* Match student dashboard: present + late count as attended */
  const attendanceStats = attendance.reduce((acc: { total: number; present: number }, record: any) => {
    acc.total++;
    if (record.status === 'present' || record.status === 'late') acc.present++;
    return acc;
  }, { total: 0, present: 0 });

  const attendanceRate = attendanceStats.total > 0 ? (attendanceStats.present / attendanceStats.total) * 100 : 0;

  const scoreStats = (scores as any[]).reduce(
    (acc: { total: number; count: number }, submission: any) => {
      const pct = submissionScorePercent(submission);
      if (pct === null) return acc;
      acc.total += pct;
      acc.count += 1;
      return acc;
    },
    { total: 0, count: 0 },
  );

  const averageScore = scoreStats.count > 0 ? scoreStats.total / scoreStats.count : 0;

  const riskDistribution = Object.values(latestBySubject).reduce((acc: Record<CanonicalRiskLevel, number>, p: any) => {
    const lvl = canonicalRiskLevel(p?.risk_level);
    acc[lvl] = (acc[lvl] || 0) + 1;
    return acc;
  }, {} as Record<CanonicalRiskLevel, number>);

  const studentRiskPieData = useMemo(
    () =>
      RISK_LEVEL_ORDER.map(level => ({
        level,
        name: riskLabel(level),
        value: riskDistribution[level] ?? 0,
      })).filter(d => d.value > 0),
    [riskDistribution],
  );

  const studentMetricsBarData = useMemo(
    () => [
      { metric: 'Attendance', value: Math.round(attendanceRate * 10) / 10 },
      { metric: 'Avg score', value: Math.round(averageScore * 10) / 10 },
    ],
    [attendanceRate, averageScore],
  );

  const studentActivityBarData = useMemo(
    () => [
      { metric: 'Predictions', count: predictions.length },
      { metric: 'Interventions', count: interventions.length },
      { metric: 'Submissions', count: scores.length },
      { metric: 'Attendance rows', count: attendance.length },
    ],
    [predictions.length, interventions.length, scores.length, attendance.length],
  );

  const studentScoreTrendData = useMemo(() => {
    const rows = (scores as any[])
      .map(s => {
        const pct = submissionScorePercent(s);
        const date = submissionTrendDateIsoDay(s);
        if (pct === null || !date) return null;
        return { date, scorePct: Math.round(pct * 10) / 10 };
      })
      .filter((row): row is { date: string; scorePct: number } => row != null)
      .sort((a, b) => a.date.localeCompare(b.date));
    return rows;
  }, [scores]);

  const studentSubjectBarData = useMemo(() => {
    return (subjects as any[]).map((subject: any) => {
      const subjectScores = (scores as any[]).filter(s => getActivityFromSubmission(s)?.subject_id === subject.id);
      const subjectAvg =
        subjectScores.length > 0
          ? subjectScores.reduce((acc, s: any) => {
              const p = submissionScorePercent(s);
              return p === null ? acc : acc + p;
            }, 0) / subjectScores.length
          : 0;
      return { code: subject.code ?? '—', avg: Math.round(subjectAvg * 10) / 10 };
    });
  }, [subjects, scores]);

  const studentPredictionsByDay = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const p of predictions as any[]) {
      if (!p.created_at) continue;
      const d = new Date(p.created_at).toISOString().slice(0, 10);
      byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));
  }, [predictions]);

  const anyLoading = predictionsLoading || interventionsLoading || subjectsLoading || attendanceLoading || scoresLoading;

  return (
    <div className="space-y-6 animate-fade-in">
      <section className="page-section overflow-hidden">
        <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
          <h1 className="text-2xl font-display font-bold">Performance Insights</h1>
        </div>
      </section>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-4 h-12">
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="analytics" className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Analytics
          </TabsTrigger>
          <TabsTrigger value="predictions" className="flex items-center gap-2">
            <Brain className="h-4 w-4" />
            AI Predictions
          </TabsTrigger>
          <TabsTrigger value="interventions" className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Interventions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          {anyLoading ? <p className="text-sm text-muted-foreground">Loading insights…</p> : null}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="bg-card/90">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Subjects</CardTitle>
                <BookOpen className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{subjects.length}</div>
                <p className="text-xs text-muted-foreground">Enrolled subjects</p>
              </CardContent>
            </Card>

            <Card className="bg-card/90">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Attendance</CardTitle>
                <Calendar className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{attendanceRate.toFixed(1)}%</div>
                <Progress value={attendanceRate} className="mt-2" />
                <p className="text-xs text-muted-foreground mt-1">
                  {attendanceStats.present} of {attendanceStats.total} classes
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card/90">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Average Score</CardTitle>
                <Award className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{averageScore.toFixed(1)}%</div>
                <Progress value={averageScore} className="mt-2" />
                <p className="text-xs text-muted-foreground mt-1">
                  Based on {scoreStats.count} submissions
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card/90">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Risk Status</CardTitle>
                <Brain className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {latestOverall ? riskLabel(canonicalRiskLevel(latestOverall.risk_level)) : 'No Data'}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Latest prediction
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            <Card className="bg-card/90">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Risk distribution
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Latest prediction per enrolled subject (your data only).
                </p>
              </CardHeader>
              <CardContent>
                {studentRiskPieData.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No risk predictions available yet.</p>
                ) : (
                  <ChartContainer config={riskChartConfig} className="mx-auto aspect-square max-h-[280px] w-full">
                    <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }} aria-label="Risk distribution pie chart">
                      <ChartTooltip content={<ChartTooltipContent nameKey="name" hideIndicator />} />
                      <Pie
                        data={studentRiskPieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={48}
                        outerRadius={88}
                        paddingAngle={2}
                      >
                        {studentRiskPieData.map(entry => (
                          <Cell key={entry.level} fill={`var(--color-${entry.level})`} stroke="transparent" />
                        ))}
                      </Pie>
                      <ChartLegend content={<ChartLegendContent nameKey="name" />} verticalAlign="bottom" />
                    </PieChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card/90">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Activity overview
                </CardTitle>
                <p className="text-sm text-muted-foreground">Counts from your enrollments and records.</p>
              </CardHeader>
              <CardContent>
                <ChartContainer config={countChartConfig} className="h-[280px] w-full">
                  <BarChart data={studentActivityBarData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} accessibilityLayer>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis dataKey="metric" tickLine={false} axisLine={false} tickMargin={8} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={6} name="Records" />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            <Card className="bg-card/90">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Score trend
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Each point is a submission with a score (% of activity max). Dates use graded time, or submitted time if
                  not graded yet. Your data only.
                </p>
              </CardHeader>
              <CardContent>
                {studentScoreTrendData.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No dated scored submissions yet—charts use graded or submitted date.</p>
                ) : (
                  <ChartContainer config={scoreTrendChartConfig} className="h-[280px] w-full">
                    <LineChart data={studentScoreTrendData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} accessibilityLayer>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
                      <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={36} label={{ value: '%', angle: -90, position: 'insideLeft' }} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line type="monotone" dataKey="scorePct" stroke="var(--color-scorePct)" strokeWidth={2} dot={{ r: 3 }} name="Score %" />
                    </LineChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card/90">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Prediction activity
                </CardTitle>
                <p className="text-sm text-muted-foreground">How many predictions were recorded per day (your history).</p>
              </CardHeader>
              <CardContent>
                {studentPredictionsByDay.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No prediction history yet.</p>
                ) : (
                  <ChartContainer config={predictionTimelineChartConfig} className="h-[280px] w-full">
                    <LineChart data={studentPredictionsByDay} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} accessibilityLayer>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line type="stepAfter" dataKey="count" stroke="var(--color-count)" strokeWidth={2} dot={{ r: 3 }} name="Count" />
                    </LineChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="bg-card/90 mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Key metrics
              </CardTitle>
              <p className="text-sm text-muted-foreground">Attendance rate and overall average score (same calculations as the summary cards).</p>
            </CardHeader>
            <CardContent>
              <ChartContainer config={metricsChartConfig} className="h-[200px] w-full max-w-lg mx-auto">
                <BarChart data={studentMetricsBarData} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }} accessibilityLayer>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis type="number" domain={[0, 100]} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="metric" tickLine={false} axisLine={false} width={88} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="value" fill="var(--color-value)" radius={6} name="Percent" />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-card/90">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Score trend (analytics)
                </CardTitle>
                <p className="text-sm text-muted-foreground">Scored submissions over time (graded or submitted date).</p>
              </CardHeader>
              <CardContent>
                {studentScoreTrendData.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No dated scored submissions yet—charts use graded or submitted date.</p>
                ) : (
                  <ChartContainer config={scoreTrendChartConfig} className="h-[300px] w-full">
                    <LineChart data={studentScoreTrendData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} accessibilityLayer>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
                      <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={36} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Line type="monotone" dataKey="scorePct" stroke="var(--color-scorePct)" strokeWidth={2} dot={{ r: 3 }} name="Score %" />
                    </LineChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card/90">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Average score by subject
                </CardTitle>
                <p className="text-sm text-muted-foreground">Mean % across graded activities per subject.</p>
              </CardHeader>
              <CardContent>
                {subjects.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No subjects enrolled</p>
                ) : (
                  <ChartContainer config={subjectScoreChartConfig} className="h-[300px] w-full">
                    <BarChart data={studentSubjectBarData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} accessibilityLayer>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis dataKey="code" tickLine={false} axisLine={false} tickMargin={8} />
                      <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={36} label={{ value: '%', angle: -90, position: 'insideLeft' }} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Bar dataKey="avg" fill="var(--color-avg)" radius={6} name="Avg %" />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="predictions" className="mt-6 space-y-6">
          <Card className="bg-card/90">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                AI Summary
              </CardTitle>
              <p className="text-muted-foreground text-sm">
                A short, actionable summary based on your latest predictions.
              </p>
            </CardHeader>
            <CardContent>
              {aiInsightLoading ? (
                <p className="text-sm text-muted-foreground">Generating AI summary…</p>
              ) : (
                <div className="rounded-xl border border-border/70 bg-muted/20 px-4 py-4">
                  <FormattedAssistantContent
                    text={aiInsight ?? 'AI summary unavailable.'}
                    className="text-[15px] leading-7"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card/90">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Brain className="h-5 w-5" />
                AI-powered risk & recommendations
              </CardTitle>
              <p className="text-muted-foreground text-sm">Your academic risk level and personalized recommendations per subject (when your instructor runs predictions).</p>
            </CardHeader>
            <CardContent>
              {predictionsLoading ? (
                <p className="text-muted-foreground text-sm">Loading predictions...</p>
              ) : Object.keys(latestBySubject).length === 0 ? (
                <p className="text-muted-foreground text-sm">No predictions yet. Your instructor will run risk analysis per subject; your insights will appear here.</p>
              ) : (
                <div className="space-y-4">
                  {Object.entries(latestBySubject).map(([, p]) => (
                    <div key={p.id} className="border rounded-lg p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{(p.subjects as any)?.code} — {(p.subjects as any)?.name}</span>
                        <Badge variant={riskVariant(canonicalRiskLevel(p.risk_level))}>
                          {riskLabel(canonicalRiskLevel(p.risk_level))}
                        </Badge>
                      </div>
                      {p.recommendation && (
                        <p className="text-sm text-muted-foreground">{p.recommendation}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Last updated: {new Date(p.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="interventions" className="mt-6">
          <Card className="bg-card/90">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <MessageSquare className="h-5 w-5" />
                Instructor interventions
              </CardTitle>
              <p className="text-muted-foreground text-sm">When your instructor logs outreach (e.g. email, meeting) for support, it will appear here.</p>
            </CardHeader>
            <CardContent>
              {interventionsLoading ? (
                <p className="text-muted-foreground text-sm">Loading interventions...</p>
              ) : interventions.length === 0 ? (
                <p className="text-muted-foreground text-sm">No interventions recorded yet.</p>
              ) : (
                <ul className="space-y-2">
                  {interventions.map((i: any) => (
                    <li key={i.id} className="flex items-start gap-2 py-2 border-b border-border/50 last:border-0 text-sm">
                      <Badge variant="outline" className="capitalize shrink-0">{i.type}</Badge>
                      <div>
                        <span className="text-muted-foreground">{(i.subjects as any)?.code}</span>
                        {i.message && <p className="mt-0.5">{i.message}</p>}
                        <p className="text-xs text-muted-foreground">{i.sent_at ? new Date(i.sent_at).toLocaleString() : ''}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InstructorInsights({ instructorId }: { instructorId: string }) {
  const { data: subjects = [], isLoading: subjectsLoading } = useQuery({
    queryKey: ['instructor-insights-subjects', instructorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subjects')
        .select('id, code, name')
        .eq('instructor_id', instructorId)
        .order('code');
      if (error) {
        console.warn('Insights: instructor subjects query failed', error);
        return [];
      }
      return data ?? [];
    },
    enabled: !!instructorId,
  });

  const subjectIds = useMemo(() => subjects.map((s: any) => s.id).filter(Boolean) as string[], [subjects]);

  const { data: enrollments = [], isLoading: enrollmentsLoading } = useQuery({
    queryKey: ['instructor-insights-enrollments', instructorId, subjectIds.join(',')],
    queryFn: async () => {
      if (subjectIds.length === 0) return [];
      const { data, error } = await supabase
        .from('enrollments')
        .select('student_id, subject_id, status')
        .in('subject_id', subjectIds)
        .eq('status', 'active');
      if (error) {
        console.warn('Insights: instructor enrollments query failed', error);
        return [];
      }
      return data ?? [];
    },
    enabled: subjectIds.length > 0,
  });

  const { data: predictions = [], isLoading: predictionsLoading } = useQuery({
    queryKey: ['instructor-insights-predictions', instructorId, subjectIds.join(',')],
    queryFn: async () => {
      if (subjectIds.length === 0) return [];
      const { data, error } = await supabase
        .from('predictions')
        .select('id, created_at, risk_level, recommendation, subject_id, student_id, subjects(code, name)')
        .in('subject_id', subjectIds)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) {
        console.warn('Insights: instructor predictions query failed', error);
        return [];
      }
      return data ?? [];
    },
    enabled: subjectIds.length > 0,
  });

  const { data: interventions = [], isLoading: interventionsLoading } = useQuery({
    queryKey: ['instructor-insights-interventions', instructorId, subjectIds.join(',')],
    queryFn: async () => {
      if (subjectIds.length === 0) return [];
      const { data, error } = await supabase
        .from('interventions')
        .select('id, type, message, sent_at, student_id, subject_id, subjects(code, name)')
        .in('subject_id', subjectIds)
        .order('sent_at', { ascending: false })
        .limit(20);
      if (error) {
        console.warn('Insights: instructor interventions query failed', error);
        return [];
      }
      return data ?? [];
    },
    enabled: subjectIds.length > 0,
  });

  const { data: aiInsight, isLoading: aiInsightLoading } = useQuery({
    queryKey: ['ai-insight-summary', instructorId],
    enabled: !!instructorId,
    queryFn: async () => {
      const data = (await invokeAiCoach({ mode: 'predictions_insight' })) as { insight?: unknown };
      return typeof data?.insight === 'string' && data.insight.trim() ? data.insight : null;
    },
  });

  const uniqueStudents = useMemo(() => new Set((enrollments ?? []).map((e: any) => e.student_id)).size, [enrollments]);

  const latestByStudentSubject = useMemo(() => {
    const acc = new Map<string, any>();
    for (const p of predictions as any[]) {
      const key = `${p.student_id}:${p.subject_id}`;
      if (!acc.has(key)) acc.set(key, p);
    }
    return Array.from(acc.values());
  }, [predictions]);

  const distribution = useMemo(() => {
    const d: Record<CanonicalRiskLevel, number> = { critical: 0, at_risk: 0, stable: 0, excelling: 0 };
    for (const p of latestByStudentSubject) d[canonicalRiskLevel(p?.risk_level)]++;
    return d;
  }, [latestByStudentSubject]);

  const instructorRiskPieData = useMemo(
    () =>
      RISK_LEVEL_ORDER.map(level => ({
        level,
        name: riskLabel(level),
        value: distribution[level] ?? 0,
      })).filter(d => d.value > 0),
    [distribution],
  );

  const instructorEnrollmentBarData = useMemo(() => {
    return (subjects as any[]).map((s: any) => ({
      code: s.code ?? '—',
      students: (enrollments as any[]).filter((e: any) => e.subject_id === s.id).length,
    }));
  }, [subjects, enrollments]);

  const instructorPredictionsByDay = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const p of predictions as any[]) {
      if (!p.created_at) continue;
      const d = new Date(p.created_at).toISOString().slice(0, 10);
      byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));
  }, [predictions]);

  /** Per subject: count of student rows (latest per student–subject) flagged critical or at-risk */
  const instructorConcernBarData = useMemo(() => {
    return (subjects as any[]).map((s: any) => {
      const rows = latestByStudentSubject.filter((p: any) => p.subject_id === s.id);
      const concern = rows.filter((p: any) => {
        const lv = canonicalRiskLevel(p.risk_level);
        return lv === 'critical' || lv === 'at_risk';
      }).length;
      return { code: s.code ?? '—', concern };
    });
  }, [subjects, latestByStudentSubject]);

  const anyLoading = subjectsLoading || enrollmentsLoading || predictionsLoading || interventionsLoading;

  return (
    <div className="space-y-6 animate-fade-in">
      <section className="page-section overflow-hidden">
        <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
          <h1 className="text-2xl font-display font-bold">Performance Insights</h1>
        </div>
      </section>

      {subjects.length === 0 && !subjectsLoading ? (
        <EmptyState
          title="No subjects yet"
          body="Once you create subjects and enroll students, you’ll see performance insights here."
        />
      ) : null}

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-4 h-12">
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="analytics" className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Analytics
          </TabsTrigger>
          <TabsTrigger value="predictions" className="flex items-center gap-2">
            <Brain className="h-4 w-4" />
            AI Predictions
          </TabsTrigger>
          <TabsTrigger value="interventions" className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Interventions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          {anyLoading ? <p className="text-sm text-muted-foreground">Loading insights…</p> : null}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="bg-card/90">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Subjects</CardTitle>
                <BookOpen className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{subjects.length}</div>
                <p className="text-xs text-muted-foreground">Active subjects</p>
              </CardContent>
            </Card>
            <Card className="bg-card/90">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Students</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{uniqueStudents}</div>
                <p className="text-xs text-muted-foreground">Across your subjects</p>
              </CardContent>
            </Card>
            <Card className="bg-card/90">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">At Risk</CardTitle>
                <TrendingDown className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{distribution.at_risk}</div>
                <p className="text-xs text-muted-foreground">Latest predictions</p>
              </CardContent>
            </Card>
            <Card className="bg-card/90">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Critical</CardTitle>
                <Brain className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{distribution.critical}</div>
                <p className="text-xs text-muted-foreground">Latest predictions</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            <Card className="bg-card/90">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Risk distribution
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Latest prediction per student per subject across your subjects only.
                </p>
              </CardHeader>
              <CardContent>
                {subjectIds.length === 0 || instructorRiskPieData.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    {subjectIds.length === 0
                      ? 'Create subjects and enroll students to see this chart.'
                      : 'No predictions yet. Run predictions from a subject page.'}
                  </p>
                ) : (
                  <ChartContainer config={riskChartConfig} className="mx-auto aspect-square max-h-[280px] w-full">
                    <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }} aria-label="Instructor risk distribution">
                      <ChartTooltip content={<ChartTooltipContent nameKey="name" hideIndicator />} />
                      <Pie
                        data={instructorRiskPieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={48}
                        outerRadius={88}
                        paddingAngle={2}
                      >
                        {instructorRiskPieData.map(entry => (
                          <Cell key={entry.level} fill={`var(--color-${entry.level})`} stroke="transparent" />
                        ))}
                      </Pie>
                      <ChartLegend content={<ChartLegendContent nameKey="name" />} verticalAlign="bottom" />
                    </PieChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card/90">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5" />
                  Active enrollments by subject
                </CardTitle>
                <p className="text-sm text-muted-foreground">Active enrollment rows per subject you teach.</p>
              </CardHeader>
              <CardContent>
                {subjects.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No subjects yet.</p>
                ) : (
                  <ChartContainer config={enrollmentChartConfig} className="h-[280px] w-full">
                    <BarChart data={instructorEnrollmentBarData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} accessibilityLayer>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis dataKey="code" tickLine={false} axisLine={false} tickMargin={8} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Bar dataKey="students" fill="var(--color-students)" radius={6} name="Students" />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="bg-card/90 mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Prediction volume
              </CardTitle>
              <p className="text-sm text-muted-foreground">Count of prediction records per day (recent window).</p>
            </CardHeader>
            <CardContent>
              {instructorPredictionsByDay.length === 0 ? (
                <p className="text-muted-foreground text-sm">No prediction history yet.</p>
              ) : (
                <ChartContainer config={predictionTimelineChartConfig} className="h-[260px] w-full">
                  <LineChart data={instructorPredictionsByDay} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} accessibilityLayer>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Line type="stepAfter" dataKey="count" stroke="var(--color-count)" strokeWidth={2} dot={{ r: 3 }} name="Predictions" />
                  </LineChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-card/90">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Risk distribution (bar)
                </CardTitle>
                <p className="text-sm text-muted-foreground">Same totals as overview: latest per student–subject pair.</p>
              </CardHeader>
              <CardContent>
                {subjectIds.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Create subjects and enroll students to see analytics.</p>
                ) : latestByStudentSubject.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No predictions yet. Run predictions from a subject page.</p>
                ) : (
                  <ChartContainer config={riskChartConfig} className="h-[300px] w-full">
                    <BarChart
                      data={RISK_LEVEL_ORDER.map(level => ({
                        level,
                        name: riskLabel(level),
                        value: distribution[level],
                      }))}
                      margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
                      accessibilityLayer
                    >
                      <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="value" radius={6} name="Students">
                        {RISK_LEVEL_ORDER.map(level => (
                          <Cell key={level} fill={`var(--color-${level})`} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card/90">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingDown className="h-5 w-5" />
                  At-risk & critical by subject
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Students (unique student–subject pairs) with latest risk critical or at-risk.
                </p>
              </CardHeader>
              <CardContent>
                {subjects.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No subjects yet.</p>
                ) : latestByStudentSubject.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No predictions yet.</p>
                ) : (
                  <ChartContainer config={concernChartConfig} className="h-[300px] w-full">
                    <BarChart data={instructorConcernBarData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} accessibilityLayer>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis dataKey="code" tickLine={false} axisLine={false} tickMargin={8} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Bar dataKey="concern" fill="var(--color-concern)" radius={6} name="Concern count" />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="bg-card/90 mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Prediction volume (analytics)
              </CardTitle>
              <p className="text-sm text-muted-foreground">Prediction records per day across your subjects.</p>
            </CardHeader>
            <CardContent>
              {instructorPredictionsByDay.length === 0 ? (
                <p className="text-muted-foreground text-sm">No prediction history yet.</p>
              ) : (
                <ChartContainer config={predictionTimelineChartConfig} className="h-[280px] w-full">
                  <LineChart data={instructorPredictionsByDay} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} accessibilityLayer>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Line type="monotone" dataKey="count" stroke="var(--color-count)" strokeWidth={2} dot={{ r: 3 }} name="Predictions" />
                  </LineChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="predictions" className="mt-6 space-y-6">
          <Card className="bg-card/90">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                AI Summary
              </CardTitle>
              <p className="text-muted-foreground text-sm">
                A short pattern summary to help you plan interventions.
              </p>
            </CardHeader>
            <CardContent>
              {aiInsightLoading ? (
                <p className="text-sm text-muted-foreground">Generating AI summary…</p>
              ) : (
                <div className="rounded-xl border border-border/70 bg-muted/20 px-4 py-4">
                  <FormattedAssistantContent
                    text={aiInsight ?? 'AI summary unavailable.'}
                    className="text-[15px] leading-7"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card/90">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Brain className="h-5 w-5" />
                Recent AI predictions
              </CardTitle>
              <p className="text-muted-foreground text-sm">Most recent predictions across your subjects.</p>
            </CardHeader>
            <CardContent>
              {predictionsLoading ? (
                <p className="text-muted-foreground text-sm">Loading predictions…</p>
              ) : predictions.length === 0 ? (
                <p className="text-muted-foreground text-sm">No predictions yet. Run predictions from a subject page.</p>
              ) : (
                <ul className="space-y-2">
                  {predictions.slice(0, 20).map((p: any) => (
                    <li key={p.id} className="flex items-start justify-between gap-3 border-b border-border/50 py-2 last:border-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {(p.subjects as any)?.code} — {(p.subjects as any)?.name}
                        </p>
                        {p.recommendation ? (
                          <p className="text-xs text-muted-foreground line-clamp-2">{p.recommendation}</p>
                        ) : null}
                        <p className="text-xs text-muted-foreground mt-1">
                          {p.created_at ? new Date(p.created_at).toLocaleString() : ''}
                        </p>
                      </div>
                      <Badge variant={riskVariant(canonicalRiskLevel(p.risk_level))} className="shrink-0">
                        {riskLabel(canonicalRiskLevel(p.risk_level))}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="interventions" className="mt-6">
          <Card className="bg-card/90">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <MessageSquare className="h-5 w-5" />
                Recent interventions
              </CardTitle>
              <p className="text-muted-foreground text-sm">Logged outreach actions (email, meeting, counseling, etc.).</p>
            </CardHeader>
            <CardContent>
              {interventionsLoading ? (
                <p className="text-muted-foreground text-sm">Loading interventions…</p>
              ) : interventions.length === 0 ? (
                <p className="text-muted-foreground text-sm">No interventions recorded yet.</p>
              ) : (
                <ul className="space-y-2">
                  {interventions.map((i: any) => (
                    <li key={i.id} className="flex items-start gap-2 py-2 border-b border-border/50 last:border-0 text-sm">
                      <Badge variant="outline" className="capitalize shrink-0">{i.type}</Badge>
                      <div className="min-w-0">
                        <span className="text-muted-foreground">{(i.subjects as any)?.code}</span>
                        {i.message && <p className="mt-0.5">{i.message}</p>}
                        <p className="text-xs text-muted-foreground">{i.sent_at ? new Date(i.sent_at).toLocaleString() : ''}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
