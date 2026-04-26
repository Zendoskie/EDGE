import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { canonicalRiskLevel, riskLabel, riskVariant } from '@/lib/risk-utils';
import { BookOpen, Calendar, FileText, Brain } from 'lucide-react';

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

export default function ParentPerformance() {
  const { user, role } = useAuth();

  const { data: approvedLink, isLoading: linkLoading } = useQuery({
    queryKey: ['parent-approved-link', user?.id],
    enabled: role === 'parent' && !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('parent_student_links')
        .select('student_user_id, student_id_no')
        .eq('parent_user_id', user!.id)
        .eq('status', 'approved')
        .order('requested_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const studentId = approvedLink?.student_user_id ?? null;

  const { data: studentProfile } = useQuery({
    queryKey: ['parent-student-profile', studentId],
    enabled: !!studentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, student_id')
        .eq('user_id', studentId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: attendance = [] } = useQuery({
    queryKey: ['parent-student-attendance', studentId],
    enabled: !!studentId,
    queryFn: async () => {
      const { data, error } = await supabase.from('attendance').select('status').eq('student_id', studentId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: scores = [] } = useQuery({
    queryKey: ['parent-student-scores', studentId],
    enabled: !!studentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('submissions')
        .select('score, activities(max_score)')
        .eq('student_id', studentId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: enrolledSubjects = [] } = useQuery({
    queryKey: ['parent-student-enrolled-subjects', studentId],
    enabled: !!studentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enrollments')
        .select('subject_id, subjects(id, code, name)')
        .eq('student_id', studentId!)
        .eq('status', 'active');
      if (error) throw error;
      return (data ?? []).filter((row: any) => row?.subject_id && row?.subjects);
    },
  });

  const enrolledSubjectIds = useMemo(
    () =>
      Array.from(
        new Set(
          (enrolledSubjects as any[])
            .map((row: any) => row?.subject_id)
            .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0),
        ),
      ),
    [enrolledSubjects],
  );

  const enrolledSubjectIdsKey = enrolledSubjectIds.join(',');

  const { data: predictions = [] } = useQuery({
    queryKey: ['parent-student-predictions', studentId],
    enabled: !!studentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('predictions')
        .select('id, subject_id, risk_level, recommendation, created_at, subject:subjects!predictions_subject_id_fkey(code,name)')
        .eq('student_id', studentId!)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const enrolledSubjectNameFallback = useMemo(() => {
    const first = (enrolledSubjects as any[])[0]?.subjects;
    return {
      code: first?.code ?? 'Subject',
      name: first?.name ?? 'Subject',
    };
  }, [enrolledSubjects]);

  const attendanceRate = useMemo(() => {
    if (attendance.length === 0) return 0;
    const present = attendance.filter((a: any) => a.status === 'present' || a.status === 'late').length;
    return (present / attendance.length) * 100;
  }, [attendance]);

  const averageScore = useMemo(() => {
    const scored = (scores as any[])
      .map((s: any) => {
        if (s?.score == null) return null;
        const max = Number(s?.activities?.max_score ?? 100);
        if (!Number.isFinite(max) || max <= 0) return null;
        return (Number(s.score) / max) * 100;
      })
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (scored.length === 0) return 0;
    return scored.reduce((acc, cur) => acc + cur, 0) / scored.length;
  }, [scores]);

  const latestPrediction = predictions[0] ?? null;

  if (role !== 'parent') {
    return (
      <EmptyState
        title="Parent access only"
        body="This page is available to parent/guardian accounts."
      />
    );
  }

  if (linkLoading) {
    return <p className="text-sm text-muted-foreground">Loading linked student…</p>;
  }

  if (!approvedLink || !studentId) {
    return (
      <div className="space-y-6 animate-fade-in">
        <section className="page-section overflow-hidden">
          <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
            <div>
              <h1 className="text-2xl font-display font-bold">Student Performance</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Your student has not approved your parent/guardian request yet.
              </p>
            </div>
          </div>
        </section>
        <EmptyState
          title="Awaiting student approval"
          body="Ask the student to open Settings and approve your parent/guardian request."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <section className="page-section overflow-hidden">
        <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
          <div>
            <h1 className="text-2xl font-display font-bold">Student Performance</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Read-only academic performance for your approved student.
            </p>
          </div>
        </div>
      </section>

      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle className="text-lg">Linked student</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-medium">{studentProfile?.full_name || 'Student'}</p>
          <p className="text-sm text-muted-foreground">
            Student ID/No.: {studentProfile?.student_id ?? approvedLink.student_id_no}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-card/90">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Attendance</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{attendanceRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">Based on {attendance.length} records</p>
          </CardContent>
        </Card>
        <Card className="bg-card/90">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average score</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{averageScore.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">Based on {scores.length} submissions</p>
          </CardContent>
        </Card>
        <Card className="bg-card/90">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Latest risk status</CardTitle>
            <Brain className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {latestPrediction ? (
              <Badge variant={riskVariant(canonicalRiskLevel(latestPrediction.risk_level))}>
                {riskLabel(canonicalRiskLevel(latestPrediction.risk_level))}
              </Badge>
            ) : (
              <p className="text-sm text-muted-foreground">No predictions yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BookOpen className="h-5 w-5" />
            Recent predictions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {predictions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No predictions available yet.</p>
          ) : (
            <div className="space-y-3">
              {predictions.map((p: any) => (
                <div key={p.id} className="rounded-lg border p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">
                      {(p.subject as any)?.code ?? enrolledSubjectNameFallback.code} — {(p.subject as any)?.name ?? enrolledSubjectNameFallback.name}
                    </p>
                    <Badge variant={riskVariant(canonicalRiskLevel(p.risk_level))}>
                      {riskLabel(canonicalRiskLevel(p.risk_level))}
                    </Badge>
                  </div>
                  {p.recommendation ? <p className="text-sm text-muted-foreground">{p.recommendation}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    {p.created_at ? new Date(p.created_at).toLocaleString() : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
