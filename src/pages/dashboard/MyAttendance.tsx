import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarCheck } from 'lucide-react';

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  present: 'default',
  late: 'secondary',
  absent: 'destructive',
  excused: 'outline',
};

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
      if (error) throw error;
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
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.id,
  });

  // Group attendance by subject
  const bySubject = enrollmentsWithSubjects.map((row: any) => {
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
  }).filter(Boolean) as { subjectId: string; code: string; name: string; records: any[]; total: number; present: number; rate: number | null }[];

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-display font-bold">My Attendance</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarCheck className="h-5 w-5" />
            Attendance by subject
          </CardTitle>
          <p className="text-muted-foreground text-sm">Your attendance history across enrolled subjects.</p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : bySubject.length === 0 ? (
            <p className="text-muted-foreground text-sm">You are not enrolled in any subjects yet. Enroll using a course code in My Subjects.</p>
          ) : (
            <div className="space-y-6">
              {bySubject.map(({ subjectId, code, name, records, total, present, rate }) => (
                <div key={subjectId} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold">{code} — {name}</p>
                      <p className="text-sm text-muted-foreground">
                        {present} of {total} sessions · {rate != null ? `${rate}%` : '—'} present
                      </p>
                    </div>
                    {rate != null && (
                      <Badge variant={rate >= 80 ? 'default' : rate >= 60 ? 'secondary' : 'destructive'}>
                        {rate}%
                      </Badge>
                    )}
                  </div>
                  {records.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {records.slice(0, 14).map((r: any) => (
                        <Badge key={`${r.date}-${r.status}`} variant={statusVariant[r.status] ?? 'outline'} className="text-xs">
                          {r.date} — {r.status}
                        </Badge>
                      ))}
                      {records.length > 14 && (
                        <span className="text-xs text-muted-foreground">+{records.length - 14} more</span>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No attendance recorded yet.</p>
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
