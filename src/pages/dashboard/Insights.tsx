import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invokeAiCoach } from '@/lib/invoke-ai-coach';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { AICoachPopup } from '@/components/AICoachPopup';
import ErrorBoundary from '@/components/ErrorBoundary';
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
  Activity
} from 'lucide-react';
import { CanonicalRiskLevel, canonicalRiskLevel, riskLabel, riskVariant } from '@/lib/risk-utils';

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

type PredictionsInsightFnResponse = { insight?: string; error?: string };

function PredictionsAIInsightCard({ queryKey, enabled }: { queryKey: string; enabled: boolean }) {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['ai-predictions-insight', queryKey],
    queryFn: async () => {
      const res = (await invokeAiCoach({ mode: 'predictions_insight' })) as PredictionsInsightFnResponse;
      if (res?.error) throw new Error(String(res.error));
      return res?.insight ?? '';
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  if (!enabled) return null;

  return (
    <Card className="mb-4 border-primary/15 bg-muted/30 bg-card/90">
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="h-4 w-4" />
              AI insight (OpenRouter)
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Summary from your prediction data. Model is set in Supabase as OPENROUTER_MODEL.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading || isFetching ? (
          <p className="text-sm text-muted-foreground">Generating insight…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : (
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{data}</p>
        )}
      </CardContent>
    </Card>
  );
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
        <div className="rounded-2xl border border-border/70 bg-card/75 backdrop-blur-sm px-5 py-4">
          <h1 className="text-2xl font-display font-bold">Performance Insights</h1>
        </div>
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
        .select('score, activities(name, subject_id, max_score)')
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

  const attendanceStats = attendance.reduce((acc: { total: number; present: number }, record: any) => {
    acc.total++;
    if (record.status === 'present') acc.present++;
    return acc;
  }, { total: 0, present: 0 });

  const attendanceRate = attendanceStats.total > 0 ? (attendanceStats.present / attendanceStats.total) * 100 : 0;

  const scoreStats = scores.reduce((acc: { total: number; count: number }, submission: any) => {
    if (submission.score !== null) {
      const max = submission.activities?.max_score ?? 100;
      if (max <= 0) return acc;
      const percentage = (submission.score / max) * 100;
      acc.total += percentage;
      acc.count++;
    }
    return acc;
  }, { total: 0, count: 0 });

  const averageScore = scoreStats.count > 0 ? scoreStats.total / scoreStats.count : 0;

  const riskDistribution = Object.values(latestBySubject).reduce((acc: Record<CanonicalRiskLevel, number>, p: any) => {
    const lvl = canonicalRiskLevel(p?.risk_level);
    acc[lvl] = (acc[lvl] || 0) + 1;
    return acc;
  }, {} as Record<CanonicalRiskLevel, number>);

  const anyLoading = predictionsLoading || interventionsLoading || subjectsLoading || attendanceLoading || scoresLoading;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="rounded-2xl border border-border/70 bg-card/75 backdrop-blur-sm px-5 py-4">
        <h1 className="text-2xl font-display font-bold">Performance Insights</h1>
      </div>

      <ErrorBoundary>
        <AICoachPopup
          riskLevel={latestOverall?.risk_level ?? null}
          recommendation={latestOverall?.recommendation ?? null}
          subjectLabel={
            latestOverall?.subjects?.code
              ? `${latestOverall.subjects.code} — ${latestOverall.subjects.name ?? ''}`.trim()
              : null
          }
          storageKey="edge_ai_coach_dismissed_insights_v1"
          variant="detailed"
        />
      </ErrorBoundary>

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
                  Risk Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(riskDistribution).map(([level, count]) => (
                    <div key={level} className="flex items-center justify-between">
                      <Badge variant={riskVariant(level as CanonicalRiskLevel)} className="capitalize">
                        {riskLabel(level as CanonicalRiskLevel)}
                      </Badge>
                      <span className="text-sm font-medium">{typeof count === 'number' ? count : 0} subject{typeof count === 'number' && count !== 1 ? 's' : ''}</span>
                    </div>
                  ))}
                  {Object.keys(riskDistribution).length === 0 && (
                    <p className="text-muted-foreground text-sm">No risk predictions available</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/90">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Latest Predictions</span>
                    <span className="font-medium">{predictions.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span>Interventions</span>
                    <span className="font-medium">{interventions.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span>Total Submissions</span>
                    <span className="font-medium">{scores.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span>Attendance Records</span>
                    <span className="font-medium">{attendance.length}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="analytics" className="mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-card/90">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Performance Trends
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Attendance Rate</span>
                    <div className="flex items-center gap-2">
                      <Progress value={attendanceRate} className="w-20" />
                      <span className="text-sm font-medium">{attendanceRate.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Average Score</span>
                    <div className="flex items-center gap-2">
                      <Progress value={averageScore} className="w-20" />
                      <span className="text-sm font-medium">{averageScore.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Subject Engagement</span>
                    <div className="flex items-center gap-2">
                      <Progress value={(subjects.length / 8) * 100} className="w-20" />
                      <span className="text-sm font-medium">{subjects.length} subjects</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Subject Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {subjects.slice(0, 5).map((subject: any) => {
                    const subjectScores = scores.filter((s: any) => 
                      s.activities?.subject_id === subject.id
                    );
                    const subjectAvg = subjectScores.length > 0 
                      ? subjectScores.reduce((acc, s: any) => {
                          const max = s.activities?.max_score ?? 100;
                          if (!max) return acc;
                          return acc + (s.score / max) * 100;
                        }, 0) / subjectScores.length
                      : 0;
                    
                    return (
                      <div key={subject.id} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span>{subject.code}</span>
                          <span className="font-medium">{subjectAvg.toFixed(1)}%</span>
                        </div>
                        <Progress value={subjectAvg} />
                      </div>
                    );
                  })}
                  {subjects.length === 0 && (
                    <p className="text-muted-foreground text-sm">No subjects enrolled</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="predictions" className="mt-6">
          <PredictionsAIInsightCard
            queryKey={`student-${userId}`}
            enabled={!predictionsLoading && Object.keys(latestBySubject).length > 0}
          />
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

  const anyLoading = subjectsLoading || enrollmentsLoading || predictionsLoading || interventionsLoading;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="rounded-2xl border border-border/70 bg-card/75 backdrop-blur-sm px-5 py-4">
        <h1 className="text-2xl font-display font-bold">Performance Insights</h1>
      </div>

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
        </TabsContent>

        <TabsContent value="analytics" className="mt-6">
          <Card className="bg-card/90">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Risk distribution (latest per student & subject)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {subjectIds.length === 0 ? (
                <p className="text-muted-foreground text-sm">Create subjects and enroll students to see analytics.</p>
              ) : latestByStudentSubject.length === 0 ? (
                <p className="text-muted-foreground text-sm">No predictions yet. Run predictions from a subject page.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {(Object.keys(distribution) as CanonicalRiskLevel[]).map((k) => (
                    <div key={k} className="border rounded-lg p-3 flex items-center justify-between">
                      <Badge variant={riskVariant(k)}>{riskLabel(k)}</Badge>
                      <span className="text-sm font-medium">{distribution[k]}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="predictions" className="mt-6">
          <PredictionsAIInsightCard
            queryKey={`instructor-${instructorId}`}
            enabled={!predictionsLoading && predictions.length > 0}
          />
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
