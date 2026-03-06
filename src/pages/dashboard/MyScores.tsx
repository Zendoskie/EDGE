import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, AlertCircle } from 'lucide-react';

function formatDue(due: string | null): string {
  if (!due) return '—';
  const d = new Date(due);
  const now = new Date();
  if (d < now) return 'Overdue';
  return d.toLocaleDateString();
}

export default function MyScores() {
  const { user } = useAuth();

  const { data: enrollments = [] } = useQuery({
    queryKey: ['my-enrollments', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('enrollments')
        .select('subject_id, subjects(id, code, name)')
        .eq('student_id', user.id)
        .eq('status', 'active');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.id,
  });

  const subjectIds = enrollments.map((e: any) => e.subjects?.id).filter(Boolean);

  const { data: activities = [] } = useQuery({
    queryKey: ['my-activities', subjectIds],
    queryFn: async () => {
      if (subjectIds.length === 0) return [];
      const { data, error } = await supabase
        .from('activities')
        .select('*')
        .in('subject_id', subjectIds)
        .order('due_date', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: subjectIds.length > 0,
  });

  const { data: submissions = [] } = useQuery({
    queryKey: ['my-submissions', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('submissions')
        .select('activity_id, score')
        .eq('student_id', user.id);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.id,
  });

  const { data: subjectsList = [] } = useQuery({
    queryKey: ['subjects-list', subjectIds],
    queryFn: async () => {
      if (subjectIds.length === 0) return [];
      const { data, error } = await supabase.from('subjects').select('id, code, name').in('id', subjectIds);
      if (error) throw error;
      return data ?? [];
    },
    enabled: subjectIds.length > 0,
  });

  const getScore = (activityId: string) => submissions.find((s: any) => s.activity_id === activityId)?.score;
  const getSubject = (subjectId: string) => subjectsList.find((s: any) => s.id === subjectId);

  const bySubject = subjectIds.map((sid: string) => {
    const sub = getSubject(sid) ?? (enrollments.find((e: any) => e.subjects?.id === sid) as any)?.subjects;
    const acts = activities.filter((a: any) => a.subject_id === sid);
    const withScores = acts.map((a: any) => ({
      ...a,
      score: getScore(a.id),
      pct: (() => {
        const s = getScore(a.id);
        if (s == null || a.max_score == null) return null;
        return Math.round((Number(s) / Number(a.max_score)) * 100);
      })(),
    }));
    const avg = withScores.filter(x => x.pct != null).length
      ? Math.round(
          withScores.filter(x => x.pct != null).reduce((s, x) => s! + x.pct!, 0)! /
            withScores.filter(x => x.pct != null).length
        )
      : null;
    return {
      subjectId: sid,
      code: sub?.code ?? '—',
      name: sub?.name ?? '—',
      activities: withScores,
      average: avg,
    };
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-display font-bold">My Scores</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5" />
            Activity scores
          </CardTitle>
          <p className="text-muted-foreground text-sm">Quiz, assignment, and project scores by subject. Due dates are shown where set.</p>
        </CardHeader>
        <CardContent>
          {bySubject.length === 0 ? (
            <p className="text-muted-foreground text-sm">You are not enrolled in any subjects yet. Enroll using a course code in My Subjects.</p>
          ) : (
            <div className="space-y-6">
              {bySubject.map(({ subjectId, code, name, activities: acts, average }) => (
                <div key={subjectId} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">{code} — {name}</p>
                    {average != null && (
                      <Badge variant="secondary">Avg: {average}%</Badge>
                    )}
                  </div>
                  {acts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No activities yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {acts.map((a: any) => {
                        const dueStr = formatDue(a.due_date);
                        const isOverdue = a.due_date && new Date(a.due_date) < new Date() && a.score == null;
                        return (
                          <li key={a.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0 text-sm">
                            <div className="flex items-center gap-2">
                              <span className="capitalize">{a.type}</span>
                              <span className="font-medium">{a.title}</span>
                              {a.due_date && (
                                <span className={`text-xs ${isOverdue ? 'text-destructive' : 'text-muted-foreground'}`}>
                                  Due: {dueStr}
                                  {isOverdue && <AlertCircle className="inline h-3 w-3 ml-0.5" />}
                                </span>
                              )}
                            </div>
                            <span className={a.score != null ? 'font-medium' : 'text-muted-foreground'}>
                              {a.score != null ? `${a.score} / ${a.max_score} (${a.pct}%)` : '—'}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
