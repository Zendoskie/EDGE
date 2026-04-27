import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, AlertCircle } from 'lucide-react';
import { averageOf, computeWeightedGrade } from '@/lib/weighted-grading';

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
      if (error) {
        console.warn('MyScores: enrollments query failed', error);
        return [];
      }
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
      if (error) {
        console.warn('MyScores: activities query failed', error);
        return [];
      }
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
      if (error) {
        console.warn('MyScores: submissions query failed', error);
        return [];
      }
      return data ?? [];
    },
    enabled: !!user?.id,
  });

  const { data: attendance = [] } = useQuery({
    queryKey: ['my-attendance-for-scores', user?.id, subjectIds],
    queryFn: async () => {
      if (!user?.id || subjectIds.length === 0) return [];
      const { data, error } = await supabase
        .from('attendance')
        .select('subject_id, status')
        .eq('student_id', user.id)
        .in('subject_id', subjectIds);
      if (error) {
        console.warn('MyScores: attendance query failed', error);
        return [];
      }
      return data ?? [];
    },
    enabled: !!user?.id && subjectIds.length > 0,
  });

  const { data: gradingSystems = [] } = useQuery({
    queryKey: ['my-grading-systems', subjectIds],
    queryFn: async () => {
      if (subjectIds.length === 0) return [];
      const { data, error } = await supabase
        .from('subject_grading_systems')
        .select('subject_id, activity_weight, project_weight, attendance_weight, exam_weight')
        .in('subject_id', subjectIds);
      if (error) {
        console.warn('MyScores: grading systems query failed', error);
        return [];
      }
      return data ?? [];
    },
    enabled: subjectIds.length > 0,
  });

  const { data: subjectsList = [] } = useQuery({
    queryKey: ['subjects-list', subjectIds],
    queryFn: async () => {
      if (subjectIds.length === 0) return [];
      const { data, error } = await supabase.from('subjects').select('id, code, name').in('id', subjectIds);
      if (error) {
        console.warn('MyScores: subjects list query failed', error);
        return [];
      }
      return data ?? [];
    },
    enabled: subjectIds.length > 0,
  });

  const getScore = (activityId: string) => submissions.find((s: any) => s.activity_id === activityId)?.score;
  const getSubject = (subjectId: string) => subjectsList.find((s: any) => s.id === subjectId);
  const getGradingSystem = (subjectId: string) => gradingSystems.find((g: any) => g.subject_id === subjectId);

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
    const attendanceRecords = attendance.filter((a: any) => a.subject_id === sid);
    const attendancePercent = attendanceRecords.length
      ? (attendanceRecords.filter((a: any) => a.status === 'present' || a.status === 'late').length / attendanceRecords.length) * 100
      : null;
    const activityAverage = averageOf(
      withScores.filter((x: any) => x.type === 'quiz' || x.type === 'assignment' || x.type === 'activity').map((x: any) => x.pct),
    );
    const projectAverage = averageOf(withScores.filter((x: any) => x.type === 'project').map((x: any) => x.pct));
    const examAverage = averageOf(withScores.filter((x: any) => x.type === 'exam').map((x: any) => x.pct));
    const weightedAverage = computeWeightedGrade({
      activityAverage,
      projectAverage,
      attendancePercent,
      examAverage,
      weights: getGradingSystem(sid) ?? null,
    });
    return {
      subjectId: sid,
      code: sub?.code ?? '—',
      name: sub?.name ?? '—',
      activities: withScores,
      average: avg,
      weightedAverage,
      gradingSystem: getGradingSystem(sid) ?? null,
    };
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <section className="page-section overflow-hidden">
        <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
          <div>
            <h1 className="text-2xl font-display font-bold">My Scores</h1>
            <p className="text-sm text-muted-foreground mt-1">Track graded activity results and averages by subject.</p>
          </div>
        </div>
      </section>

      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5" />
            Activity scores
          </CardTitle>
          <p className="text-muted-foreground text-sm">Quiz, assignment, and project scores by subject. Due dates are shown where set.</p>
        </CardHeader>
        <CardContent>
          <div className="mb-5 rounded-lg border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">How your exact grades and averages are computed</p>
            <p>
              For each graded activity, the system computes a percentage using
              <span className="font-medium text-foreground"> (score / max score) x 100</span>. Example: <span className="font-medium text-foreground">18 / 20 = 90%</span>.
            </p>
            <p>
              The <span className="font-medium text-foreground">Activity Avg</span> beside each subject is the mean of all available activity percentages in that subject:
              <span className="font-medium text-foreground"> (sum of graded activity percentages) / (count of graded activities)</span>.
            </p>
            <p>
              If your instructor configured a grading system for the subject, the system also computes
              <span className="font-medium text-foreground"> Weighted %</span> using Activity, Project, Attendance, and Exam categories.
              Formula: <span className="font-medium text-foreground">(Activity x w1 + Project x w2 + Attendance x w3 + Exam x w4) / (w1 + w2 + w3 + w4)</span>.
            </p>
            <p>
              Activities marked <span className="font-medium text-foreground">—</span> are not graded yet and are excluded from the average until a score is entered.
              Struggle areas are identified from repeated low percentages in this list, especially when they align with low attendance or risk alerts.
            </p>
          </div>
          {bySubject.length === 0 ? (
            <p className="text-muted-foreground text-sm">You are not enrolled in any subjects yet. Enroll using a course code in My Subjects.</p>
          ) : (
            <div className="space-y-6">
              {bySubject.map(({ subjectId, code, name, activities: acts, average, weightedAverage, gradingSystem }) => (
                <div key={subjectId} className="border border-border/70 rounded-xl bg-card/70 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">{code} — {name}</p>
                    <div className="flex items-center gap-2">
                      {average != null && (
                        <Badge variant="outline">
                          Activity Avg: {average}%
                        </Badge>
                      )}
                      {gradingSystem && weightedAverage != null ? (
                        <Badge variant="secondary">
                          Weighted: {Math.round(weightedAverage)}%
                        </Badge>
                      ) : null}
                    </div>
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
