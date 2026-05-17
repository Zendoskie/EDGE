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
import {
  filterAttendanceBySubjectIds,
  filterPredictionsBySubjectIds,
  filterSubmissionsByActiveSubjects,
  getActivityFromSubmission,
  pickLatestPredictionByCreatedAt,
  resolveStudentRiskSummary,
} from '@/lib/student-performance-scope';
import { invokeAiCoach } from '@/lib/invoke-ai-coach';
import { FormattedAssistantContent } from '@/components/FormattedAssistantContent';
import { InsightsChartFrame } from '@/components/insights/InsightsChartFrame';

const RISK_LEVEL_ORDER: CanonicalRiskLevel[] = ['critical', 'at_risk', 'stable', 'excelling'];

const INSIGHTS_TABS_LIST =
  'flex w-full max-w-full gap-1 overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] p-1 h-auto sm:grid sm:grid-cols-4 sm:overflow-visible sm:gap-0 sm:py-1 sm:h-12';

const INSIGHTS_TAB_TRIGGER =
  'shrink-0 min-w-[4.75rem] !text-xs !px-2 sm:min-w-0 sm:flex-1 sm:!text-sm sm:!px-3.5';

const CHART_MARGIN = { top: 8, right: 8, left: 4, bottom: 28 };
const CHART_MARGIN_TALL_X = { top: 8, right: 8, left: 4, bottom: 52 };
const MOBILE_AXIS_TICK = { fontSize: 10 };

const CHART_H_SM = 'aspect-auto h-[220px] sm:h-[280px] w-full max-w-full';
const CHART_H_MD = 'aspect-auto h-[240px] sm:h-[300px] w-full max-w-full';
const PIE_CHART_CLASS = 'mx-auto aspect-square max-h-[220px] sm:max-h-[280px] w-full max-w-[min(100%,300px)]';

/** Recharts / ChartContainer colors — aligned with semantic risk levels (readable in light & dark) */
const riskChartConfig = {
  critical: { label: 'Crucial', theme: { light: 'hsl(0 72% 51%)', dark: 'hsl(0 72% 58%)' } },
  at_risk: { label: 'Vulnerable', theme: { light: 'hsl(38 92% 50%)', dark: 'hsl(38 92% 56%)' } },
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
  concern: { label: 'Students (crucial / vulnerable)', theme: { light: 'hsl(0 72% 51%)', dark: 'hsl(0 72% 58%)' } },
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
    <Card className="bg-card/90 min-w-0 w-full">
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
      <div className="space-y-6 animate-fade-in min-w-0">
        <section className="page-section overflow-hidden">
          <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
            <h1 className="text-xl sm:text-2xl font-display font-bold">Performance Insights</h1>
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

  const subjectIdSet = useMemo(() => {
    const ids = new Set<string>();
    for (const s of subjects as any[]) {
      if (s?.id) ids.add(String(s.id));
    }
    return ids;
  }, [subjects]);

  const predictionsScoped = useMemo(() => {
    if (subjectsLoading) return [];
    return filterPredictionsBySubjectIds(predictions as any[], subjectIdSet);
  }, [predictions, subjectIdSet, subjectsLoading]);

  const attendanceScoped = useMemo(() => {
    if (subjectsLoading) return [];
    return filterAttendanceBySubjectIds(attendance as any[], subjectIdSet);
  }, [attendance, subjectIdSet, subjectsLoading]);

  const scoresScoped = useMemo(() => {
    if (subjectsLoading) return [];
    return filterSubmissionsByActiveSubjects(scores as any[], subjectIdSet);
  }, [scores, subjectIdSet, subjectsLoading]);

  const interventionsScoped = useMemo(() => {
    if (subjectsLoading) return [];
    return (interventions as any[]).filter(
      (i) => typeof i.subject_id === 'string' && subjectIdSet.has(i.subject_id),
    );
  }, [interventions, subjectIdSet, subjectsLoading]);

  const latestBySubject = useMemo(() => {
    return predictionsScoped.reduce((acc: Record<string, any>, p: any) => {
      const sid = p.subject_id;
      if (!sid) return acc;
      if (!acc[sid] || new Date(p.created_at) > new Date(acc[sid].created_at)) acc[sid] = p;
      return acc;
    }, {});
  }, [predictionsScoped]);

  const attendanceStats = attendanceScoped.reduce(
    (acc: { total: number; present: number }, record: any) => {
      acc.total++;
      if (record.status === 'present' || record.status === 'late') acc.present++;
      return acc;
    },
    { total: 0, present: 0 },
  );

  const attendanceRate = attendanceStats.total > 0 ? (attendanceStats.present / attendanceStats.total) * 100 : 0;

  const scoreStats = (scoresScoped as any[]).reduce(
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

  const riskSummary = useMemo(() => {
    const latest = pickLatestPredictionByCreatedAt(predictionsScoped as any[]);
    const attTotal = attendanceScoped.length;
    const attPresent = attendanceScoped.filter(
      (a: any) => a.status === 'present' || a.status === 'late',
    ).length;
    const attendanceRatePercent = attTotal > 0 ? Math.round((attPresent / attTotal) * 100) : null;
    let sum = 0;
    let cnt = 0;
    for (const submission of scoresScoped as any[]) {
      const pct = submissionScorePercent(submission);
      if (pct != null) {
        sum += pct;
        cnt++;
      }
    }
    const overallAveragePercent = cnt > 0 ? Math.round(sum / cnt) : null;
    return resolveStudentRiskSummary({
      overallAveragePercent,
      attendanceRatePercent,
      latestPrediction: latest
        ? {
            risk_level: latest.risk_level,
            created_at: latest.created_at,
            recommendation: (latest as any).recommendation ?? null,
            subjects: (latest as any).subjects ?? null,
          }
        : null,
    });
  }, [predictionsScoped, attendanceScoped, scoresScoped]);

  const riskDistribution = Object.values(latestBySubject).reduce(
    (acc: Record<CanonicalRiskLevel, number>, p: any) => {
      const lvl = canonicalRiskLevel(p?.risk_level);
      acc[lvl] = (acc[lvl] || 0) + 1;
      return acc;
    },
    {} as Record<CanonicalRiskLevel, number>,
  );

  const studentRiskPieData = useMemo(
    () =>
      RISK_LEVEL_ORDER.map((level) => ({
        level,
        name: riskLabel(level),
        value: riskDistribution[level] ?? 0,
      })).filter((d) => d.value > 0),
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
      { metric: 'Predictions', count: predictionsScoped.length },
      { metric: 'Interventions', count: interventionsScoped.length },
      { metric: 'Submissions', count: scoresScoped.length },
      { metric: 'Attendance', count: attendanceScoped.length },
    ],
    [predictionsScoped.length, interventionsScoped.length, scoresScoped.length, attendanceScoped.length],
  );

  const studentScoreTrendData = useMemo(() => {
    const rows = (scoresScoped as any[])
      .map((s) => {
        const pct = submissionScorePercent(s);
        const date = submissionTrendDateIsoDay(s);
        if (pct === null || !date) return null;
        return { date, scorePct: Math.round(pct * 10) / 10 };
      })
      .filter((row): row is { date: string; scorePct: number } => row != null)
      .sort((a, b) => a.date.localeCompare(b.date));
    return rows;
  }, [scoresScoped]);

  const studentSubjectBarData = useMemo(() => {
    return (subjects as any[]).map((subject: any) => {
      const subjectScores = (scoresScoped as any[]).filter(
        (s) => getActivityFromSubmission(s)?.subject_id === subject.id,
      );
      const subjectAvg =
        subjectScores.length > 0
          ? subjectScores.reduce((acc, s: any) => {
              const p = submissionScorePercent(s);
              return p === null ? acc : acc + p;
            }, 0) / subjectScores.length
          : 0;
      return { code: subject.code ?? '—', avg: Math.round(subjectAvg * 10) / 10 };
    });
  }, [subjects, scoresScoped]);

  const studentPredictionsByDay = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const p of predictionsScoped as any[]) {
      if (!p.created_at) continue;
      const d = new Date(p.created_at).toISOString().slice(0, 10);
      byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));
  }, [predictionsScoped]);

  const anyLoading = predictionsLoading || interventionsLoading || subjectsLoading || attendanceLoading || scoresLoading;

  return (
    <div className="space-y-6 animate-fade-in min-w-0">
      <section className="page-section overflow-hidden">
        <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
          <h1 className="text-xl sm:text-2xl font-display font-bold">Performance Insights</h1>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Disclaimer: This system provides academic-related insights only.
      </p>

      <Tabs defaultValue="overview" className="w-full min-w-0">
        <TabsList className={INSIGHTS_TABS_LIST}>
          <TabsTrigger value="overview" className={`flex items-center justify-center gap-1 sm:gap-2 ${INSIGHTS_TAB_TRIGGER}`}>
            <BarChart3 className="h-4 w-4 shrink-0" />
            <span>Overview</span>
          </TabsTrigger>
          <TabsTrigger value="analytics" className={`flex items-center justify-center gap-1 sm:gap-2 ${INSIGHTS_TAB_TRIGGER}`}>
            <Activity className="h-4 w-4 shrink-0" />
            <span>Analytics</span>
          </TabsTrigger>
          <TabsTrigger value="predictions" className={`flex items-center justify-center gap-1 sm:gap-2 ${INSIGHTS_TAB_TRIGGER}`}>
            <Brain className="h-4 w-4 shrink-0" />
            <span>Predictions</span>
          </TabsTrigger>
          <TabsTrigger value="interventions" className={`flex items-center justify-center gap-1 sm:gap-2 ${INSIGHTS_TAB_TRIGGER}`}>
            <MessageSquare className="h-4 w-4 shrink-0" />
            <span>Interventions</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 min-w-0">
          {anyLoading ? <p className="text-sm text-muted-foreground">Loading insights…</p> : null}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <Card className="bg-card/90 min-w-0 w-full">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Subjects</CardTitle>
                <BookOpen className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{subjects.length}</div>
                <p className="text-xs text-muted-foreground">Enrolled subjects</p>
              </CardContent>
            </Card>

            <Card className="bg-card/90 min-w-0 w-full">
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

            <Card className="bg-card/90 min-w-0 w-full">
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

            <Card className="bg-card/90 min-w-0 w-full">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Risk Status</CardTitle>
                <Brain className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {subjectsLoading ? '…' : riskSummary.riskStatusLabel === '—' ? 'No Data' : riskSummary.riskStatusLabel}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Same logic as your dashboard (enrolled subjects only)
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            <Card className="bg-card/90 min-w-0 w-full">
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
                  <InsightsChartFrame minWidth={260}>
                  <ChartContainer config={riskChartConfig} className={PIE_CHART_CLASS}>
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
                  </InsightsChartFrame>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card/90 min-w-0 w-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Activity overview
                </CardTitle>
                <p className="text-sm text-muted-foreground">Counts from your enrollments and records.</p>
              </CardHeader>
              <CardContent>
                <InsightsChartFrame>
                <ChartContainer config={countChartConfig} className={CHART_H_SM}>
                  <BarChart data={studentActivityBarData} margin={CHART_MARGIN} accessibilityLayer>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis dataKey="metric" tickLine={false} axisLine={false} tickMargin={8} tick={MOBILE_AXIS_TICK} interval={0} angle={-25} textAnchor="end" height={48} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} tick={MOBILE_AXIS_TICK} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={6} name="Records" />
                  </BarChart>
                </ChartContainer>
                </InsightsChartFrame>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            <Card className="bg-card/90 min-w-0 w-full">
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
                  <InsightsChartFrame>
                  <ChartContainer config={scoreTrendChartConfig} className={CHART_H_SM}>
                    <LineChart data={studentScoreTrendData} margin={CHART_MARGIN} accessibilityLayer>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} tick={MOBILE_AXIS_TICK} />
                      <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={32} tick={MOBILE_AXIS_TICK} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line type="monotone" dataKey="scorePct" stroke="var(--color-scorePct)" strokeWidth={2} dot={{ r: 3 }} name="Score %" />
                    </LineChart>
                  </ChartContainer>
                  </InsightsChartFrame>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card/90 min-w-0 w-full">
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
                  <InsightsChartFrame>
                  <ChartContainer config={predictionTimelineChartConfig} className={CHART_H_SM}>
                    <LineChart data={studentPredictionsByDay} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} accessibilityLayer>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line type="stepAfter" dataKey="count" stroke="var(--color-count)" strokeWidth={2} dot={{ r: 3 }} name="Count" />
                    </LineChart>
                  </ChartContainer>
                  </InsightsChartFrame>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="bg-card/90 mt-6 min-w-0 w-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Key metrics
              </CardTitle>
              <p className="text-sm text-muted-foreground">Attendance rate and overall average score (same calculations as the summary cards).</p>
            </CardHeader>
            <CardContent>
              <InsightsChartFrame minWidth={260}>
              <ChartContainer config={metricsChartConfig} className={`${CHART_H_SM} max-w-lg mx-auto`}>
                <BarChart data={studentMetricsBarData} layout="vertical" margin={{ top: 8, right: 16, left: 4, bottom: 8 }} accessibilityLayer>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis type="number" domain={[0, 100]} tickLine={false} axisLine={false} tick={MOBILE_AXIS_TICK} />
                  <YAxis type="category" dataKey="metric" tickLine={false} axisLine={false} width={56} tick={MOBILE_AXIS_TICK} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="value" fill="var(--color-value)" radius={6} name="Percent" />
                </BarChart>
              </ChartContainer>
              </InsightsChartFrame>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="mt-6 min-w-0">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-card/90 min-w-0 w-full">
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
                  <InsightsChartFrame>
                  <ChartContainer config={scoreTrendChartConfig} className={CHART_H_MD}>
                    <LineChart data={studentScoreTrendData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} accessibilityLayer>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
                      <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={36} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Line type="monotone" dataKey="scorePct" stroke="var(--color-scorePct)" strokeWidth={2} dot={{ r: 3 }} name="Score %" />
                    </LineChart>
                  </ChartContainer>
                  </InsightsChartFrame>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card/90 min-w-0 w-full">
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
                  <InsightsChartFrame>
                  <ChartContainer config={subjectScoreChartConfig} className={CHART_H_MD}>
                    <BarChart data={studentSubjectBarData} margin={CHART_MARGIN_TALL_X} accessibilityLayer>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis dataKey="code" tickLine={false} axisLine={false} tickMargin={8} tick={MOBILE_AXIS_TICK} interval={0} angle={-35} textAnchor="end" height={56} />
                      <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={32} tick={MOBILE_AXIS_TICK} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Bar dataKey="avg" fill="var(--color-avg)" radius={6} name="Avg %" />
                    </BarChart>
                  </ChartContainer>
                  </InsightsChartFrame>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="predictions" className="mt-6 space-y-6 min-w-0">
          <Card className="bg-card/90 min-w-0 w-full">
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
                <div className="rounded-xl border border-border/70 bg-muted/20 px-3 py-3 sm:px-4 sm:py-4 overflow-hidden min-w-0">
                  <FormattedAssistantContent
                    text={aiInsight ?? 'AI summary unavailable.'}
                    className="text-[15px] leading-7"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card/90 min-w-0 w-full">
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
                  {Object.entries(latestBySubject).map(([, p]) => {
                    const row = p as Prediction;
                    return (
                    <div key={row.id} className="border rounded-lg p-3 sm:p-4 space-y-2 min-w-0">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                        <span className="font-medium text-sm sm:text-base break-words min-w-0">{(row.subjects as any)?.code} — {(row.subjects as any)?.name}</span>
                        <Badge variant={riskVariant(canonicalRiskLevel(row.risk_level))} className="shrink-0 self-start">
                          {riskLabel(canonicalRiskLevel(row.risk_level))}
                        </Badge>
                      </div>
                      {row.recommendation && (
                        <p className="text-sm text-muted-foreground break-words">{row.recommendation}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Last updated: {new Date(row.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="interventions" className="mt-6 min-w-0">
          <Card className="bg-card/90 min-w-0 w-full">
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
              ) : interventionsScoped.length === 0 ? (
                <p className="text-muted-foreground text-sm">No interventions recorded yet.</p>
              ) : (
                <ul className="space-y-2">
                  {interventionsScoped.map((i: any) => (
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

  const instructorPredictionsScoped = useMemo(() => {
    const keys = new Set(
      (enrollments as { student_id?: string; subject_id?: string }[])
        .filter((e) => e.student_id && e.subject_id)
        .map((e) => `${e.student_id}:${e.subject_id}`),
    );
    return (predictions as any[]).filter(
      (p) => p.student_id && p.subject_id && keys.has(`${p.student_id}:${p.subject_id}`),
    );
  }, [predictions, enrollments]);

  const latestByStudentSubject = useMemo(() => {
    const acc = new Map<string, any>();
    for (const p of instructorPredictionsScoped as any[]) {
      const key = `${p.student_id}:${p.subject_id}`;
      if (!acc.has(key)) acc.set(key, p);
    }
    return Array.from(acc.values());
  }, [instructorPredictionsScoped]);

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
    for (const p of instructorPredictionsScoped as any[]) {
      if (!p.created_at) continue;
      const d = new Date(p.created_at).toISOString().slice(0, 10);
      byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));
  }, [instructorPredictionsScoped]);

  /** Per subject: count of student rows (latest per student–subject) flagged crucial or vulnerable */
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
    <div className="space-y-6 animate-fade-in min-w-0">
      <section className="page-section overflow-hidden">
        <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
          <h1 className="text-xl sm:text-2xl font-display font-bold">Performance Insights</h1>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Disclaimer: This system provides academic-related insights only.
      </p>

      {subjects.length === 0 && !subjectsLoading ? (
        <EmptyState
          title="No subjects yet"
          body="Once you create subjects and enroll students, you’ll see performance insights here."
        />
      ) : null}

      <Tabs defaultValue="overview" className="w-full min-w-0">
        <TabsList className={INSIGHTS_TABS_LIST}>
          <TabsTrigger value="overview" className={`flex items-center justify-center gap-1 sm:gap-2 ${INSIGHTS_TAB_TRIGGER}`}>
            <BarChart3 className="h-4 w-4 shrink-0" />
            <span>Overview</span>
          </TabsTrigger>
          <TabsTrigger value="analytics" className={`flex items-center justify-center gap-1 sm:gap-2 ${INSIGHTS_TAB_TRIGGER}`}>
            <Activity className="h-4 w-4 shrink-0" />
            <span>Analytics</span>
          </TabsTrigger>
          <TabsTrigger value="predictions" className={`flex items-center justify-center gap-1 sm:gap-2 ${INSIGHTS_TAB_TRIGGER}`}>
            <Brain className="h-4 w-4 shrink-0" />
            <span>Predictions</span>
          </TabsTrigger>
          <TabsTrigger value="interventions" className={`flex items-center justify-center gap-1 sm:gap-2 ${INSIGHTS_TAB_TRIGGER}`}>
            <MessageSquare className="h-4 w-4 shrink-0" />
            <span>Interventions</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 min-w-0">
          {anyLoading ? <p className="text-sm text-muted-foreground">Loading insights…</p> : null}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <Card className="bg-card/90 min-w-0 w-full">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Subjects</CardTitle>
                <BookOpen className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{subjects.length}</div>
                <p className="text-xs text-muted-foreground">Active subjects</p>
              </CardContent>
            </Card>
            <Card className="bg-card/90 min-w-0 w-full">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Students</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{uniqueStudents}</div>
                <p className="text-xs text-muted-foreground">Across your subjects</p>
              </CardContent>
            </Card>
            <Card className="bg-card/90 min-w-0 w-full">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Vulnerable</CardTitle>
                <TrendingDown className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{distribution.at_risk}</div>
                <p className="text-xs text-muted-foreground">Latest predictions</p>
              </CardContent>
            </Card>
            <Card className="bg-card/90 min-w-0 w-full">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Crucial</CardTitle>
                <Brain className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{distribution.critical}</div>
                <p className="text-xs text-muted-foreground">Latest predictions</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            <Card className="bg-card/90 min-w-0 w-full">
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
                  <InsightsChartFrame minWidth={260}>
                  <ChartContainer config={riskChartConfig} className={PIE_CHART_CLASS}>
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
                  </InsightsChartFrame>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card/90 min-w-0 w-full">
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
                  <InsightsChartFrame>
                  <ChartContainer config={enrollmentChartConfig} className={CHART_H_SM}>
                    <BarChart data={instructorEnrollmentBarData} margin={CHART_MARGIN_TALL_X} accessibilityLayer>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis dataKey="code" tickLine={false} axisLine={false} tickMargin={8} tick={MOBILE_AXIS_TICK} interval={0} angle={-35} textAnchor="end" height={56} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} tick={MOBILE_AXIS_TICK} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Bar dataKey="students" fill="var(--color-students)" radius={6} name="Students" />
                    </BarChart>
                  </ChartContainer>
                  </InsightsChartFrame>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="bg-card/90 mt-6 min-w-0 w-full">
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
                <InsightsChartFrame>
                <ChartContainer config={predictionTimelineChartConfig} className={CHART_H_SM}>
                  <LineChart data={instructorPredictionsByDay} margin={CHART_MARGIN} accessibilityLayer>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} tick={MOBILE_AXIS_TICK} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} tick={MOBILE_AXIS_TICK} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Line type="stepAfter" dataKey="count" stroke="var(--color-count)" strokeWidth={2} dot={{ r: 3 }} name="Predictions" />
                  </LineChart>
                </ChartContainer>
                </InsightsChartFrame>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="mt-6 min-w-0">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-card/90 min-w-0 w-full">
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
                  <InsightsChartFrame>
                  <ChartContainer config={riskChartConfig} className={CHART_H_MD}>
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
                  </InsightsChartFrame>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card/90 min-w-0 w-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingDown className="h-5 w-5" />
                  Vulnerable & crucial by subject
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Students (unique student–subject pairs) with latest risk crucial or vulnerable.
                </p>
              </CardHeader>
              <CardContent>
                {subjects.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No subjects yet.</p>
                ) : latestByStudentSubject.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No predictions yet.</p>
                ) : (
                  <InsightsChartFrame>
                  <ChartContainer config={concernChartConfig} className={CHART_H_MD}>
                    <BarChart data={instructorConcernBarData} margin={CHART_MARGIN_TALL_X} accessibilityLayer>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis dataKey="code" tickLine={false} axisLine={false} tickMargin={8} tick={MOBILE_AXIS_TICK} interval={0} angle={-35} textAnchor="end" height={56} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} tick={MOBILE_AXIS_TICK} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Bar dataKey="concern" fill="var(--color-concern)" radius={6} name="Concern count" />
                    </BarChart>
                  </ChartContainer>
                  </InsightsChartFrame>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="bg-card/90 mt-6 min-w-0 w-full">
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
                <InsightsChartFrame>
                <ChartContainer config={predictionTimelineChartConfig} className={CHART_H_SM}>
                  <LineChart data={instructorPredictionsByDay} margin={CHART_MARGIN} accessibilityLayer>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} tick={MOBILE_AXIS_TICK} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} tick={MOBILE_AXIS_TICK} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Line type="monotone" dataKey="count" stroke="var(--color-count)" strokeWidth={2} dot={{ r: 3 }} name="Predictions" />
                  </LineChart>
                </ChartContainer>
                </InsightsChartFrame>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="predictions" className="mt-6 space-y-6 min-w-0">
          <Card className="bg-card/90 min-w-0 w-full">
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
                <div className="rounded-xl border border-border/70 bg-muted/20 px-3 py-3 sm:px-4 sm:py-4 overflow-hidden min-w-0">
                  <FormattedAssistantContent
                    text={aiInsight ?? 'AI summary unavailable.'}
                    className="text-[15px] leading-7"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card/90 min-w-0 w-full">
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
              ) : instructorPredictionsScoped.length === 0 ? (
                <p className="text-muted-foreground text-sm">No predictions yet. Run predictions from a subject page.</p>
              ) : (
                <ul className="space-y-2">
                  {instructorPredictionsScoped.slice(0, 20).map((p: any) => (
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

        <TabsContent value="interventions" className="mt-6 min-w-0">
          <Card className="bg-card/90 min-w-0 w-full">
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
