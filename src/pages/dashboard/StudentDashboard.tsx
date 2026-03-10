import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BookOpen, CalendarCheck, BarChart3, Brain } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function StudentDashboard() {
  const { user } = useAuth();

  const programCode = (user?.user_metadata as any)?.course as string | undefined;
  const yearLevel = (user?.user_metadata as any)?.year_level as string | undefined;

  const { data: program } = useQuery({
    queryKey: ['student-program', programCode],
    queryFn: async () => {
      if (!programCode) return null;
      const { data, error } = await supabase
        .from('programs')
        .select('code, name')
        .eq('code', programCode)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!programCode,
  });

  const { data: stats } = useQuery({
    queryKey: ['student-dashboard-stats', user?.id],
    queryFn: async () => {
      const { data: enrollments } = await supabase
        .from('enrollments')
        .select('subject_id')
        .eq('student_id', user!.id)
        .eq('status', 'active');
      const enrolledCount = enrollments?.length ?? 0;

      const { data: attRecords } = await supabase
        .from('attendance')
        .select('status')
        .eq('student_id', user!.id);
      const total = attRecords?.length ?? 0;
      const present = attRecords?.filter(a => a.status === 'present' || a.status === 'late').length ?? 0;
      const attendanceRate = total > 0 ? Math.round((present / total) * 100) : null;

      const { data: subs } = await supabase
        .from('submissions')
        .select('score, activities(max_score)')
        .eq('student_id', user!.id);
      let overallAvg: number | null = null;
      if (subs?.length) {
        const weighted: number[] = [];
        subs.forEach((s: any) => {
          const act = s.activities;
          const max = (act && typeof act === 'object' && 'max_score' in act) ? act.max_score : 100;
          if (s.score != null && max) weighted.push((Number(s.score) / Number(max)) * 100);
        });
        overallAvg = weighted.length ? Math.round(weighted.reduce((a, b) => a + b, 0) / weighted.length) : null;
      }

      const { data: pred } = await supabase
        .from('predictions')
        .select('risk_level')
        .eq('student_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      return {
        enrolledSubjects: enrolledCount,
        attendanceRate: attendanceRate != null ? `${attendanceRate}%` : '—',
        overallAverage: overallAvg != null ? `${overallAvg}%` : '—',
        riskStatus: pred?.risk_level ? (pred.risk_level === 'critical' ? 'Critical' : pred.risk_level === 'at_risk' ? 'At Risk' : pred.risk_level === 'excelling' ? 'Excelling' : 'Stable') : '—',
      };
    },
    enabled: !!user?.id,
  });

  const { data: recentActivity = [] } = useQuery({
    queryKey: ['student-recent-activity', user?.id],
    queryFn: async () => {
      const { data: subs } = await supabase
        .from('submissions')
        .select('score, graded_at, activity_id, activities(id, title, type, max_score, subjects(code, name))')
        .eq('student_id', user!.id)
        .order('graded_at', { ascending: false })
        .limit(5);
      return subs ?? [];
    },
    enabled: !!user?.id,
  });

  const statCards = [
    { title: 'Enrolled Subjects', value: stats?.enrolledSubjects ?? '—', icon: BookOpen, color: 'text-primary' },
    { title: 'Attendance Rate', value: stats?.attendanceRate ?? '—', icon: CalendarCheck, color: 'text-success' },
    { title: 'Overall Average', value: stats?.overallAverage ?? '—', icon: BarChart3, color: 'text-accent-foreground' },
    { title: 'Risk Status', value: stats?.riskStatus ?? '—', icon: Brain, color: 'text-muted-foreground' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-display font-bold">Student Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Your academic performance at a glance</p>
        {(programCode || yearLevel) && (
          <div className="mt-2 space-y-1 text-sm text-muted-foreground">
            {programCode && (
              <div>
                <span className="font-medium text-foreground">Program:</span>{' '}
                {program?.code ?? programCode}
                {program?.name ? ` — ${program.name}` : ''}
              </div>
            )}
            {yearLevel && (
              <div>
                <span className="font-medium text-foreground">Year level:</span> {yearLevel}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Recent Activity</CardTitle>
          <Button variant="outline" size="sm" asChild>
            <Link to="/dashboard/my-scores">View Scores</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {recentActivity.length === 0 ? (
            <p className="text-muted-foreground text-sm">No activity yet. Your performance data will appear here once your instructor records grades.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {recentActivity.map((s: any) => {
                const act = s.activities;
                const subj = act?.subjects;
                const maxScore = act?.max_score ?? 100;
                return (
                  <li key={s.activity_id ?? s.graded_at} className="flex items-center justify-between py-1 border-b border-border/50 last:border-0">
                    <span>{subj?.code ?? '—'} — {act?.title ?? 'Activity'}</span>
                    <Badge variant="secondary">{s.score != null ? `${Math.round((Number(s.score) / Number(maxScore)) * 100)}%` : '—'}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
