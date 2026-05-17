import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useCounselingReferrals } from '@/hooks/useCounselingReferrals';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReferralStatusBadge } from '@/components/ReferralStatusBadge';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { normalizeReferralStatus } from '@/lib/referral-utils';

export default function GuidanceReferrals() {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const { data: referrals = [], isLoading } = useCounselingReferrals();

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'approved' | 'rejected' }) => {
      const { error } = await supabase
        .from('counseling_referrals')
        .update({
          status,
          reviewed_at: new Date().toISOString(),
          reviewed_by: user!.id,
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['guidance-referrals', user?.id] });
      void queryClient.invalidateQueries({ queryKey: ['student-counseling-referrals'] });
      void queryClient.invalidateQueries({ queryKey: ['instructor-counseling-referrals'] });
      void queryClient.invalidateQueries({ queryKey: ['counseling-referrals'] });
      toast.success(vars.status === 'approved' ? 'Referral approved' : 'Referral rejected');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pendingCount = useMemo(
    () => referrals.filter((r) => normalizeReferralStatus(r.status) === 'pending').length,
    [referrals],
  );

  const { data: feedback = [] } = useQuery({
    queryKey: ['guidance-student-feedback', user?.id, referrals.length],
    enabled: role === 'guidance_counselor' && !!user?.id && referrals.length > 0,
    queryFn: async () => {
      const studentIds = Array.from(new Set(referrals.map((r) => r.student_id).filter(Boolean)));
      const subjectIds = Array.from(new Set(referrals.map((r) => r.subject_id).filter(Boolean)));
      if (studentIds.length === 0 || subjectIds.length === 0) return [];
      const { data, error } = await supabase
        .from('student_feedback')
        .select('id, created_at, student_id, subject_id, risk_level, reasons, details')
        .in('student_id', studentIds)
        .in('subject_id', subjectIds)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      const feedbackRows = data ?? [];
      if (feedbackRows.length === 0) return [];

      const uniqStudentIds = Array.from(new Set(feedbackRows.map((f: { student_id: string }) => f.student_id).filter(Boolean)));
      const uniqSubjectIds = Array.from(new Set(feedbackRows.map((f: { subject_id: string }) => f.subject_id).filter(Boolean)));

      const [studentsRes, subjectsRes] = await Promise.all([
        uniqStudentIds.length > 0
          ? supabase.from('profiles').select('user_id, full_name, email, student_id').in('user_id', uniqStudentIds)
          : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
        uniqSubjectIds.length > 0
          ? supabase.from('subjects').select('id, code, name').in('id', uniqSubjectIds)
          : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
      ]);
      if (studentsRes.error) throw studentsRes.error;
      if (subjectsRes.error) throw subjectsRes.error;

      const studentMap = new Map((studentsRes.data ?? []).map((p) => [(p as { user_id: string }).user_id, p]));
      const subjectMap = new Map((subjectsRes.data ?? []).map((s) => [(s as { id: string }).id, s]));

      return feedbackRows.map((f: Record<string, unknown>) => ({
        ...f,
        student: studentMap.get(f.student_id as string) ?? null,
        subject: subjectMap.get(f.subject_id as string) ?? null,
      }));
    },
  });

  if (role !== 'guidance_counselor') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="space-y-6 animate-fade-in min-w-0">
      <section className="page-section overflow-hidden">
        <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
          <div>
            <h1 className="text-2xl font-display font-bold">Counseling Referrals</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Review instructor counseling requests. Counseling interventions can proceed only after approval.
            </p>
          </div>
        </div>
      </section>

      <Card className="bg-card/90 w-full min-w-0">
        <CardHeader>
          <CardTitle className="text-lg">
            Pending referrals: {pendingCount}
          </CardTitle>
        </CardHeader>
        <CardContent className="min-w-0">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading referrals…</p>
          ) : referrals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No referrals yet.</p>
          ) : (
            <div className="space-y-3">
              {referrals.map((r) => (
                <div key={r.id} className="rounded-xl border border-border/60 p-3 sm:p-4 space-y-2 min-w-0">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {r.subject?.code ?? r.subject_id} — {r.subject?.name ?? 'Subject name unavailable'}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        Student: {r.student?.full_name ?? r.student?.email ?? r.student_id} ({r.student?.student_id ?? 'Student no. unavailable'})
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        Referred by: {r.instructor?.full_name ?? r.instructor?.email ?? '—'}
                      </p>
                    </div>
                    <ReferralStatusBadge status={r.status} className="shrink-0 self-start" />
                  </div>
                  {r.recommendation_message ? (
                    <p className="text-sm text-muted-foreground">{r.recommendation_message}</p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    Requested: {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                    {r.reviewed_at ? ` · Reviewed ${new Date(r.reviewed_at).toLocaleString()}` : ''}
                  </p>
                  {normalizeReferralStatus(r.status) === 'pending' ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        onClick={() => reviewMutation.mutate({ id: r.id, status: 'approved' })}
                        disabled={reviewMutation.isPending}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => reviewMutation.mutate({ id: r.id, status: 'rejected' })}
                        disabled={reviewMutation.isPending}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/90 w-full min-w-0">
        <CardHeader>
          <CardTitle className="text-lg">Student feedback</CardTitle>
        </CardHeader>
        <CardContent className="min-w-0">
          {feedback.length === 0 ? (
            <p className="text-sm text-muted-foreground">No feedback submitted for referred students yet.</p>
          ) : (
            <div className="space-y-3">
              {feedback.map((f: {
                id: string;
                subject?: { code?: string; name?: string } | null;
                subject_id?: string;
                student?: { full_name?: string; email?: string; student_id?: string } | null;
                student_id?: string;
                risk_level?: string;
                reasons?: string[];
                details?: string;
                created_at?: string;
              }) => (
                <div key={f.id} className="rounded-xl border border-border/60 p-3 sm:p-4 space-y-2 min-w-0">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {(f.subject?.code ?? f.subject_id)} — {(f.subject?.name ?? 'Subject')}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        Student: {(f.student?.full_name ?? f.student?.email ?? f.student_id)} ({f.student?.student_id ?? '—'})
                      </p>
                    </div>
                    <Badge variant={f.risk_level === 'critical' || f.risk_level === 'at_risk' ? 'destructive' : 'secondary'}>
                      {f.risk_level === 'critical' ? 'Crucial' : f.risk_level === 'at_risk' ? 'Vulnerable' : f.risk_level}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(f.reasons ?? []).slice(0, 8).map((reason: string) => (
                      <Badge key={reason} variant="outline" className="text-xs">{reason}</Badge>
                    ))}
                  </div>
                  {f.details ? <p className="text-sm text-muted-foreground">{f.details}</p> : null}
                  <p className="text-xs text-muted-foreground">{f.created_at ? new Date(f.created_at).toLocaleString() : ''}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
