import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, BookOpen, Brain, AlertTriangle, AlertOctagon, GraduationCap, Calendar, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Bar, BarChart, XAxis, YAxis, CartesianGrid, Cell } from 'recharts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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

const getYearFromSubject = (subject: any) => {
  const code = subject.code || '';
  const yearMatch = code.match(/(\d+)/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1]);
    if (year >= 1 && year <= 4) return year;
  }
  return 1; // Default to year 1 if no year found
};

export default function InstructorDashboard() {
  const { user } = useAuth();

  const { data: subjectsWithPrograms } = useQuery({
    queryKey: ['instructor-subjects-programs', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subjects')
        .select(`
          id, 
          name, 
          code, 
          semester, 
          academic_year,
          program_id,
          programs(id, code, name)
        `)
        .eq('instructor_id', user!.id)
        .order('code');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.id,
  });

  const { data: stats } = useQuery({
    queryKey: ['instructor-dashboard-stats', user?.id],
    queryFn: async () => {
      const subjectIds = subjectsWithPrograms?.map(s => s.id) ?? [];
      if (subjectIds.length === 0) {
        return { totalStudents: 0, activeSubjects: 0, predictionsRun: 0, atRiskStudents: 0, criticalStudents: 0 };
      }
      const [enrollmentsRes, predictionsRes] = await Promise.all([
        supabase.from('enrollments').select('student_id').eq('status', 'active').in('subject_id', subjectIds),
        supabase.from('predictions').select('id, risk_level').in('subject_id', subjectIds),
      ]);
      const uniqueStudents = new Set(enrollmentsRes.data?.map(e => e.student_id) ?? []).size;
      const atRisk = predictionsRes.data?.filter(p => p.risk_level === 'at_risk').length ?? 0;
      const critical = predictionsRes.data?.filter(p => p.risk_level === 'critical').length ?? 0;
      return {
        totalStudents: uniqueStudents,
        activeSubjects: subjectIds.length,
        predictionsRun: predictionsRes.data?.length ?? 0,
        atRiskStudents: atRisk,
        criticalStudents: critical,
      };
    },
    enabled: !!user?.id && !!subjectsWithPrograms,
  });

  const { data: analyticsData } = useQuery({
    queryKey: ['instructor-analytics', user?.id],
    queryFn: async () => {
      const ids = subjectsWithPrograms?.map(s => s.id) ?? [];
      if (ids.length === 0) return { chartData: [], byProgram: [], needIntervention: [] };
      const { data: predictions } = await supabase
        .from('predictions')
        .select('id, risk_level, subject_id, student_id, subjects(id, code, name)')
        .in('subject_id', ids);
      const preds = predictions ?? [];
      const criticalAndAtRisk = preds.filter((p: any) => p.risk_level === 'critical' || p.risk_level === 'at_risk');
      const chartData = [
        { level: 'Critical', count: preds.filter((p: any) => p.risk_level === 'critical').length, fill: 'hsl(0 72% 51%)' },
        { level: 'At Risk', count: preds.filter((p: any) => p.risk_level === 'at_risk').length, fill: 'hsl(38 92% 50%)' },
        { level: 'Stable', count: preds.filter((p: any) => p.risk_level === 'stable').length, fill: 'hsl(215 15% 50%)' },
        { level: 'Excelling', count: preds.filter((p: any) => p.risk_level === 'excelling').length, fill: 'hsl(215 65% 36%)' },
      ];
      const programCount: Record<string, number> = {};
      const programMeta: Record<string, { code: string; name?: string | null }> = {};
      for (const s of subjectsWithPrograms ?? []) {
        const p = (s as any).programs;
        const code = p?.code ?? 'Unassigned';
        programCount[code] = (programCount[code] ?? 0) + 1;
        if (!programMeta[code]) {
          programMeta[code] = { code, name: p?.name };
        }
      }
      const byProgram = Object.entries(programCount).map(([code, count]) => {
        const meta = programMeta[code];
        const label = meta?.name ? `${code} — ${meta.name}` : code;
        return { code, label, count };
      });
      return { chartData: chartData.filter(d => d.count > 0), byProgram, needIntervention: criticalAndAtRisk };
    },
    enabled: !!user?.id && !!subjectsWithPrograms,
  });

  const { data: recentPredictions = [] } = useQuery({
    queryKey: ['instructor-recent-predictions', user?.id],
    queryFn: async () => {
      const ids = subjectsWithPrograms?.map(s => s.id) ?? [];
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from('predictions')
        .select('id, risk_level, recommendation, subject_id, subjects(code, name)')
        .in('subject_id', ids)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.id && !!subjectsWithPrograms,
  });

  // Group subjects by program and year
  const groupedByProgramAndYear = subjectsWithPrograms?.reduce((acc: Record<string, Record<number, any[]>>, subject) => {
    const programCode = subject.programs?.code || 'Unassigned';
    const year = getYearFromSubject(subject);
    
    if (!acc[programCode]) {
      acc[programCode] = {};
    }
    if (!acc[programCode][year]) {
      acc[programCode][year] = [];
    }
    acc[programCode][year].push(subject);
    return acc;
  }, {}) || {};

  // Get subject stats for each subject
  const { data: subjectStats } = useQuery({
    queryKey: ['subject-stats', user?.id],
    queryFn: async () => {
      const ids = subjectsWithPrograms?.map(s => s.id) ?? [];
      if (ids.length === 0) return {};
      
      const [enrollmentsRes, predictionsRes] = await Promise.all([
        supabase.from('enrollments').select('subject_id, student_id, status').in('subject_id', ids),
        supabase.from('predictions').select('subject_id, risk_level').in('subject_id', ids),
      ]);

      const stats: Record<string, { students: number; atRisk: number; critical: number; predictions: number }> = {};
      
      ids.forEach(id => {
        stats[id] = { students: 0, atRisk: 0, critical: 0, predictions: 0 };
      });

      enrollmentsRes.data?.forEach(enrollment => {
        if (enrollment.status === 'active' && stats[enrollment.subject_id]) {
          stats[enrollment.subject_id].students++;
        }
      });

      predictionsRes.data?.forEach(prediction => {
        if (stats[prediction.subject_id]) {
          stats[prediction.subject_id].predictions++;
          if (prediction.risk_level === 'at_risk') stats[prediction.subject_id].atRisk++;
          if (prediction.risk_level === 'critical') stats[prediction.subject_id].critical++;
        }
      });

      return stats;
    },
    enabled: !!user?.id && !!subjectsWithPrograms,
  });

  const statCards = [
    { title: 'Total Students', value: stats?.totalStudents ?? '—', icon: Users, color: 'text-primary' },
    { title: 'Active Subjects', value: stats?.activeSubjects ?? '—', icon: BookOpen, color: 'text-accent-foreground' },
    { title: 'Predictions Run', value: stats?.predictionsRun ?? '—', icon: Brain, color: 'text-success' },
    { title: 'Critical', value: stats?.criticalStudents ?? '—', icon: AlertOctagon, color: 'text-destructive' },
    { title: 'At Risk', value: stats?.atRiskStudents ?? '—', icon: AlertTriangle, color: 'text-amber-500' },
  ];

  const chartConfig = { count: { label: 'Students' }, level: { label: 'Risk Level' } };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-display font-bold">Instructor Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage your courses organized by program and year level</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.title}</CardTitle>
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="courses">Courses by Program</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Brain className="h-5 w-5" />
                  Risk Distribution
                </CardTitle>
                <p className="text-sm text-muted-foreground">Student risk levels across your subjects</p>
              </CardHeader>
              <CardContent>
                {!analyticsData?.chartData?.length ? (
                  <p className="text-muted-foreground text-sm py-8 text-center">No prediction data yet. Run predictions from a subject page.</p>
                ) : (
                  <ChartContainer config={chartConfig} className="h-[200px] w-full">
                    <BarChart data={analyticsData.chartData} layout="vertical" margin={{ left: 0, right: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" />
                      <YAxis dataKey="level" type="category" width={80} tick={{ fontSize: 12 }} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="count" radius={4}>
                        {analyticsData.chartData.map((entry, index) => (
                          <Cell key={index} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <GraduationCap className="h-5 w-5" />
                  Programs Overview
                </CardTitle>
                <p className="text-sm text-muted-foreground">Your courses across different programs</p>
              </CardHeader>
              <CardContent>
                {!analyticsData?.byProgram?.length ? (
                  <p className="text-muted-foreground text-sm py-8 text-center">No subjects with programs yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {analyticsData.byProgram.map((p: { code: string; label: string; count: number }) => (
                      <Badge key={p.code} variant="secondary" className="text-sm py-1 px-3">
                        {p.label}: {p.count}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {analyticsData?.needIntervention?.length ? (
            <Card className="mt-6">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertOctagon className="h-5 w-5 text-destructive" />
                  Interventions Needed
                </CardTitle>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/dashboard/subjects">View Subjects</Link>
                </Button>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">Students with critical or lower scores that may need instructor intervention.</p>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {analyticsData.needIntervention.slice(0, 15).map((p: any) => (
                    <div key={p.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                      <Badge variant={p.risk_level === 'critical' ? 'destructive' : 'outline'}>
                        {riskLabel(p.risk_level)}
                      </Badge>
                      <span className="text-sm truncate flex-1 mx-3">{(p.subjects as any)?.code}</span>
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/dashboard/subjects/${p.subject_id}`}>Intervene</Link>
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card className="mt-6">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Recent Predictions</CardTitle>
              <Button variant="outline" size="sm" asChild>
                <Link to="/dashboard/subjects">View Subjects</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {recentPredictions.length === 0 ? (
                <p className="text-muted-foreground text-sm">No predictions have been run yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {recentPredictions.slice(0, 5).map((p: any) => (
                    <li key={p.id} className="flex items-center justify-between py-1 border-b border-border/50 last:border-0">
                      <span>{(p.subjects as any)?.code} — {riskLabel(p.risk_level)}</span>
                      <span className="text-muted-foreground text-xs">{(p.subjects as any)?.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="courses" className="mt-6">
          <div className="space-y-8">
            {Object.entries(groupedByProgramAndYear).map(([programCode, years]) => (
              <Card key={programCode}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <GraduationCap className="h-5 w-5" />
                    {programCode} Program
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    {Object.entries(years)
                      .sort(([a], [b]) => parseInt(a) - parseInt(b))
                      .map(([year, subjects]) => (
                        <div key={`${programCode}-${year}`} className="border-l-4 border-blue-500 pl-4">
                          <div className="flex items-center gap-2 mb-4">
                            <Badge variant="outline" className="text-lg px-3 py-1">
                              Year {year}
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              {subjects.length} course{subjects.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {subjects.map((subject) => {
                              const stats = subjectStats?.[subject.id] || { students: 0, atRisk: 0, critical: 0, predictions: 0 };
                              return (
                                <Card key={subject.id} className="hover:shadow-md transition-shadow">
                                  <CardHeader className="pb-3">
                                    <div className="flex items-start justify-between">
                                      <div>
                                        <CardTitle className="text-base">{subject.code}</CardTitle>
                                        <p className="text-sm text-muted-foreground">{subject.name}</p>
                                        <div className="flex items-center gap-2 mt-2">
                                          <Badge variant="outline" className="text-xs">
                                            {subject.semester}
                                          </Badge>
                                          <Badge variant="outline" className="text-xs">
                                            {subject.academic_year}
                                          </Badge>
                                        </div>
                                      </div>
                                    </div>
                                  </CardHeader>
                                  <CardContent className="pt-0">
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between text-sm">
                                        <span className="text-muted-foreground">Students</span>
                                        <span className="font-medium">{stats.students}</span>
                                      </div>
                                      <div className="flex items-center justify-between text-sm">
                                        <span className="text-muted-foreground">Predictions</span>
                                        <span className="font-medium">{stats.predictions}</span>
                                      </div>
                                      {(stats.atRisk > 0 || stats.critical > 0) && (
                                        <div className="flex gap-2 mt-2">
                                          {stats.atRisk > 0 && (
                                            <Badge variant="outline" className="text-xs text-amber-600">
                                              {stats.atRisk} At Risk
                                            </Badge>
                                          )}
                                          {stats.critical > 0 && (
                                            <Badge variant="destructive" className="text-xs">
                                              {stats.critical} Critical
                                            </Badge>
                                          )}
                                        </div>
                                      )}
                                      <Button variant="outline" size="sm" className="w-full mt-3" asChild>
                                        <Link to={`/dashboard/subjects/${subject.id}`}>
                                          Manage Course
                                        </Link>
                                      </Button>
                                    </div>
                                  </CardContent>
                                </Card>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            ))}
            {Object.keys(groupedByProgramAndYear).length === 0 && (
              <Card>
                <CardContent className="py-12 text-center">
                  <GraduationCap className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No Courses Assigned</h3>
                  <p className="text-muted-foreground">You haven't been assigned to any courses yet.</p>
                  <Button variant="outline" className="mt-4" asChild>
                    <Link to="/dashboard/subjects">Manage Subjects</Link>
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="analytics" className="mt-6">
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Detailed Analytics
                </CardTitle>
                <p className="text-sm text-muted-foreground">Comprehensive view of your teaching performance</p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.entries(groupedByProgramAndYear).map(([programCode, years]) => (
                    <div key={programCode} className="border rounded-lg p-4">
                      <h4 className="font-medium mb-3">{programCode}</h4>
                      <div className="space-y-2">
                        {Object.entries(years)
                          .sort(([a], [b]) => parseInt(a) - parseInt(b))
                          .map(([year, subjects]) => {
                            const totalStudents = subjects.reduce((sum, s) => 
                              sum + (subjectStats?.[s.id]?.students || 0), 0
                            );
                            const totalAtRisk = subjects.reduce((sum, s) => 
                              sum + (subjectStats?.[s.id]?.atRisk || 0), 0
                            );
                            const totalCritical = subjects.reduce((sum, s) => 
                              sum + (subjectStats?.[s.id]?.critical || 0), 0
                            );
                            
                            return (
                              <div key={`${programCode}-${year}`} className="text-sm">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium">Year {year}</span>
                                  <span className="text-muted-foreground">{subjects.length} courses</span>
                                </div>
                                <div className="flex gap-2 mt-1">
                                  <span className="text-xs text-muted-foreground">
                                    {totalStudents} students
                                  </span>
                                  {(totalAtRisk > 0 || totalCritical > 0) && (
                                    <>
                                      {totalAtRisk > 0 && (
                                        <Badge variant="outline" className="text-xs text-amber-600">
                                          {totalAtRisk} at risk
                                        </Badge>
                                      )}
                                      {totalCritical > 0 && (
                                        <Badge variant="destructive" className="text-xs">
                                          {totalCritical} critical
                                        </Badge>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
