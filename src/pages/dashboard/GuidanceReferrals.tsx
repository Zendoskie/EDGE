import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function GuidanceReferrals() {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();

  const { data: referrals = [], isLoading } = useQuery({
    queryKey: ['guidance-referrals', user?.id],
    enabled: role === 'guidance_counselor' && !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('counseling_referrals')
        .select('id, student_id, subject_id, instructor_id, recommendation_message, status, created_at, reviewed_at');
      if (error) throw error;

      const studentIds = Array.from(new Set((data ?? []).map((r: any) => r.student_id).filter(Boolean)));
      const instructorIds = Array.from(new Set((data ?? []).map((r: any) => r.instructor_id).filter(Boolean)));
      const subjectIds = Array.from(new Set((data ?? []).map((r: any) => r.subject_id).filter(Boolean)));

      const [studentsRes, instructorsRes, subjectsRes] = await Promise.all([
        studentIds.length > 0
          ? supabase.from('profiles').select('user_id, full_name, email, student_id').in('user_id', studentIds)
          : Promise.resolve({ data: [] as any[] }),
        instructorIds.length > 0
          ? supabase.from('profiles').select('user_id, full_name, email').in('user_id', instructorIds)
          : Promise.resolve({ data: [] as any[] }),
        subjectIds.length > 0
          ? supabase.from('subjects').select('id, code, name').in('id', subjectIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      if (studentsRes.error) throw studentsRes.error;
      if (instructorsRes.error) throw instructorsRes.error;
      if (subjectsRes.error) throw subjectsRes.error;

      const studentMap = new Map((studentsRes.data ?? []).map((p: any) => [p.user_id, p]));
      const instructorMap = new Map((instructorsRes.data ?? []).map((p: any) => [p.user_id, p]));
      const subjectMap = new Map((subjectsRes.data ?? []).map((s: any) => [s.id, s]));

      return (data ?? []).map((r: any) => ({
        ...r,
        student: studentMap.get(r.student_id) ?? null,
        instructor: instructorMap.get(r.instructor_id) ?? null,
        subject: subjectMap.get(r.subject_id) ?? null,
      }));
    },
  });

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
      queryClient.invalidateQueries({ queryKey: ['guidance-referrals', user?.id] });
      toast.success(vars.status === 'approved' ? 'Referral approved' : 'Referral rejected');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pendingCount = useMemo(() => referrals.filter((r: any) => r.status === 'pending').length, [referrals]);

  if (role !== 'guidance_counselor') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
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

      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle className="text-lg">
            Pending referrals: {pendingCount}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading referrals…</p>
          ) : referrals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No referrals yet.</p>
          ) : (
            <div className="space-y-3">
              {referrals.map((r: any) => (
                <div key={r.id} className="rounded-xl border border-border/60 p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {r.subject?.code ?? r.subject_id} — {r.subject?.name ?? 'Subject name unavailable'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Student: {r.student?.full_name ?? r.student?.email ?? r.student_id} ({r.student?.student_id ?? 'Student no. unavailable'})
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Referred by: {r.instructor?.full_name ?? r.instructor?.email ?? '—'}
                      </p>
                    </div>
                    <Badge variant={r.status === 'approved' ? 'default' : r.status === 'rejected' ? 'destructive' : 'secondary'}>
                      {r.status}
                    </Badge>
                  </div>
                  {r.recommendation_message ? (
                    <p className="text-sm text-muted-foreground">{r.recommendation_message}</p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    Requested: {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                  </p>
                  {r.status === 'pending' ? (
                    <div className="flex gap-2 pt-1">
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
    </div>
  );
}
