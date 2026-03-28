import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { CalendarCheck } from 'lucide-react';

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  present: 'default',
  late: 'secondary',
  absent: 'destructive',
  excused: 'outline',
};

function formatSessionDate(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function MyAttendance() {
  const { user } = useAuth();

  const { data: enrollmentsWithSubjects = [], isLoading } = useQuery({
    queryKey: ['my-enrollments', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('enrollments')
        .select('subject_id, subjects(id, code, name)')
        .eq('student_id', user.id)
        .eq('status', 'active');
      if (error) {
        console.warn('MyAttendance: enrollments query failed', error);
        return [];
      }
      return data ?? [];
    },
    enabled: !!user?.id,
  });

  const { data: attendanceBySubject = [] } = useQuery({
    queryKey: ['my-attendance', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('attendance')
        .select('subject_id, date, status')
        .eq('student_id', user.id)
        .order('date', { ascending: false });
      if (error) {
        console.warn('MyAttendance: attendance query failed', error);
        return [];
      }
      return data ?? [];
    },
    enabled: !!user?.id,
  });

  const bySubject = enrollmentsWithSubjects
    .map((row: any) => {
      const sub = row.subjects;
      if (!sub) return null;
      const records = attendanceBySubject.filter((a: any) => a.subject_id === sub.id);
      const total = records.length;
      const present = records.filter((a: any) => a.status === 'present' || a.status === 'late').length;
      const rate = total > 0 ? Math.round((present / total) * 100) : null;
      return {
        subjectId: sub.id,
        code: sub.code,
        name: sub.name,
        records,
        total,
        present,
        rate,
      };
    })
    .filter(Boolean) as {
    subjectId: string;
    code: string;
    name: string;
    records: { subject_id: string; date: string; status: string }[];
    total: number;
    present: number;
    rate: number | null;
  }[];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="rounded-2xl border border-border/70 bg-card/75 backdrop-blur-sm px-5 py-4">
        <h1 className="text-2xl font-display font-bold">My Attendance</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Sessions are listed newest first. Each row shows the class date and your status.
        </p>
      </div>

      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarCheck className="h-5 w-5" />
            By subject
          </CardTitle>
          <p className="text-muted-foreground text-sm">Attendance history across your active enrollments.</p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : bySubject.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              You are not enrolled in any subjects yet. Enroll using a course code in My Subjects.
            </p>
          ) : (
            <div className="space-y-8">
              {bySubject.map(({ subjectId, code, name, records, total, present, rate }) => (
                <section key={subjectId} className="space-y-4">
                  <div className="rounded-xl border border-border/70 bg-muted/20 px-4 py-4 space-y-3">
                    <div className="flex flex-col gap-1">
                      <h2 className="text-base font-semibold text-foreground">
                        {code} — {name}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {present} present / late out of {total} recorded session{total !== 1 ? 's' : ''}
                        {rate != null ? ` · ${rate}% attendance` : ''}
                      </p>
                    </div>
                    {rate != null && (
                      <div className="space-y-1.5">
                        <Progress value={rate} className="h-2" />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>0%</span>
                          <span className="font-medium tabular-nums">{rate}%</span>
                          <span>100%</span>
                        </div>
                      </div>
                    )}
                    {rate != null && (
                      <Badge
                        variant={rate >= 80 ? 'default' : rate >= 60 ? 'secondary' : 'destructive'}
                        className="w-fit"
                      >
                        {rate >= 80 ? 'On track' : rate >= 60 ? 'Watch closely' : 'Needs attention'}
                      </Badge>
                    )}
                  </div>

                  {records.length > 0 ? (
                    <ul className="rounded-xl border border-border/60 bg-card/50 divide-y divide-border/60 overflow-hidden">
                      {records.map((r) => (
                        <li key={`${r.date}-${r.status}`} className="px-4 py-3.5 flex flex-col gap-2">
                          <span className="text-sm font-medium text-foreground leading-snug">
                            {formatSessionDate(r.date)}
                          </span>
                          <Badge
                            variant={statusVariant[r.status] ?? 'outline'}
                            className="w-fit capitalize text-xs font-medium"
                          >
                            {r.status}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground pl-1">No attendance recorded yet for this subject.</p>
                  )}
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
