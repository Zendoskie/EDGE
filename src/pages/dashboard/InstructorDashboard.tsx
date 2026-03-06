import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, BookOpen, Brain, AlertTriangle, AlertOctagon, GraduationCap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Bar, BarChart, XAxis, YAxis, CartesianGrid, Cell } from 'recharts';

const riskLabel = (level: string) => {
  if (level === 'critical') return 'Critical';
  if (level === 'at_risk') return 'At Risk';
  if (level === 'excelling') return 'Excelling';
  return 'Stable';
};

export default function InstructorDashboard() {
  const { user } = useAuth();

  const { data: stats } = useQuery({
    queryKey: ['instructor-dashboard-stats', user?.id],
    queryFn: async () => {
      const { data: mySubjects } = await supabase.from('subjects').select('id, program_id, programs(code, name)').eq('instructor_id', user!.id);
      const subjectIds = mySubjects?.map(s => s.id) ?? [];
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
    enabled: !!user?.id,
  });

  const { data: analyticsData } = useQuery({
    queryKey: ['instructor-analytics', user?.id],
    queryFn: async () => {
      const { data: subjectIds } = await supabase.from('subjects').select('id, program_id, programs(code, name)').eq('instructor_id', user!.id);
      const ids = subjectIds?.map(s => s.id) ?? [];
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
      for (const s of subjectIds ?? []) {
        const p = (s as any).programs;
        const code = p?.code ?? 'Unassigned';
        programCount[code] = (programCount[code] ?? 0) + 1;
      }
      const byProgram = Object.entries(programCount).map(([name, count]) => ({ name, count }));
      return { chartData: chartData.filter(d => d.count > 0), byProgram, needIntervention: criticalAndAtRisk };
    },
    enabled: !!user?.id,
  });

  const { data: recentPredictions = [] } = useQuery({
    queryKey: ['instructor-recent-predictions', user?.id],
    queryFn: async () => {
      const { data: subjectIds } = await supabase.from('subjects').select('id').eq('instructor_id', user!.id);
      const ids = subjectIds?.map(s => s.id) ?? [];
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
    enabled: !!user?.id,
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
        <h1 className="text-2xl font-display font-bold">Data Analytics for Student Performance</h1>
        <p className="text-muted-foreground text-sm mt-1">Overview of your academic monitoring across all courses</p>
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
              Subjects by Program
            </CardTitle>
            <p className="text-sm text-muted-foreground">Platform for all courses (BSCS, BSBA, BEED, BSED)</p>
          </CardHeader>
          <CardContent>
            {!analyticsData?.byProgram?.length ? (
              <p className="text-muted-foreground text-sm py-8 text-center">No subjects with programs yet. Assign programs when creating subjects.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {analyticsData.byProgram.map((p: { name: string; count: number }) => (
                  <Badge key={p.name} variant="secondary" className="text-sm py-1 px-3">
                    {p.name}: {p.count}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {analyticsData?.needIntervention?.length ? (
        <Card>
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Recent Predictions</CardTitle>
          <Button variant="outline" size="sm" asChild>
            <Link to="/dashboard/subjects">View Subjects</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {recentPredictions.length === 0 ? (
            <p className="text-muted-foreground text-sm">No predictions have been run yet. Create subjects, enroll students, and record grades, then run predictions from a subject page.</p>
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
    </div>
  );
}
