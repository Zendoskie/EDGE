import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
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

export default function Insights() {
  const { user } = useAuth();

  const { data: predictions = [], isLoading: predictionsLoading } = useQuery({
    queryKey: ['my-predictions', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('predictions')
        .select('*, subjects(id, code, name)')
        .eq('student_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.id,
  });

  const { data: interventions = [], isLoading: interventionsLoading } = useQuery({
    queryKey: ['my-interventions', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('interventions')
        .select('id, type, message, sent_at, subject_id, subjects(code, name)')
        .eq('student_id', user.id)
        .order('sent_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.id,
  });

  const { data: subjects = [], isLoading: subjectsLoading } = useQuery({
    queryKey: ['my-subjects', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('enrollments')
        .select('subjects(id, code, name)')
        .eq('student_id', user.id);
      if (error) throw error;
      return data?.map(e => e.subjects) ?? [];
    },
    enabled: !!user?.id,
  });

  const { data: attendance = [], isLoading: attendanceLoading } = useQuery({
    queryKey: ['my-attendance-stats', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('attendance')
        .select('status, subjects(code, name)')
        .eq('student_id', user.id);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.id,
  });

  const { data: scores = [], isLoading: scoresLoading } = useQuery({
    queryKey: ['my-scores-stats', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('submissions')
        .select('score, max_score, activities(name, subject_id)')
        .eq('student_id', user.id);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.id,
  });

  const riskLabel = (level: string) => {
    if (level === 'critical') return 'Critical';
    if (level === 'at_risk') return 'At Risk';
    if (level === 'excelling') return 'Excelling';
    return 'Stable';
  };

  const riskVariant = (level: string): 'destructive' | 'default' | 'secondary' => {
    if (level === 'critical' || level === 'at_risk') return 'destructive';
    if (level === 'excelling') return 'default';
    return 'secondary';
  };

  const latestBySubject = predictions.reduce((acc: Record<string, any>, p) => {
    const sid = p.subject_id;
    if (!acc[sid] || new Date(p.created_at) > new Date(acc[sid].created_at)) acc[sid] = p;
    return acc;
  }, {});

  // Calculate statistics
  const attendanceStats = attendance.reduce((acc, record) => {
    acc.total++;
    if (record.status === 'present') acc.present++;
    return acc;
  }, { total: 0, present: 0 });

  const attendanceRate = attendanceStats.total > 0 ? (attendanceStats.present / attendanceStats.total) * 100 : 0;

  const scoreStats = scores.reduce((acc, submission) => {
    if (submission.score !== null && submission.max_score > 0) {
      const percentage = (submission.score / submission.max_score) * 100;
      acc.total += percentage;
      acc.count++;
    }
    return acc;
  }, { total: 0, count: 0 });

  const averageScore = scoreStats.count > 0 ? scoreStats.total / scoreStats.count : 0;

  const riskDistribution = Object.values(latestBySubject).reduce((acc, p) => {
    acc[p.risk_level] = (acc[p.risk_level] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-display font-bold">Performance Insights</h1>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Subjects</CardTitle>
                <BookOpen className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{subjects.length}</div>
                <p className="text-xs text-muted-foreground">Enrolled subjects</p>
              </CardContent>
            </Card>

            <Card>
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

            <Card>
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

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Risk Status</CardTitle>
                <Brain className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {Object.keys(latestBySubject).length > 0 
                    ? riskLabel(Object.values(latestBySubject)[0].risk_level)
                    : 'No Data'
                  }
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Latest prediction
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            <Card>
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
                      <Badge variant={riskVariant(level)} className="capitalize">
                        {riskLabel(level)}
                      </Badge>
                      <span className="text-sm font-medium">{count} subject{count !== 1 ? 's' : ''}</span>
                    </div>
                  ))}
                  {Object.keys(riskDistribution).length === 0 && (
                    <p className="text-muted-foreground text-sm">No risk predictions available</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
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
            <Card>
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
                    const subjectScores = scores.filter(s => 
                      s.activities?.subject_id === subject.id
                    );
                    const subjectAvg = subjectScores.length > 0 
                      ? subjectScores.reduce((acc, s) => acc + (s.score / s.max_score) * 100, 0) / subjectScores.length
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
          <Card>
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
                        <Badge variant={riskVariant(p.risk_level)}>{riskLabel(p.risk_level)}</Badge>
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
          <Card>
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
