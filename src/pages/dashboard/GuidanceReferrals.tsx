import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useCounselingReferrals } from '@/hooks/useCounselingReferrals';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReferralStatusBadge } from '@/components/ReferralStatusBadge';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { RiskBadge } from '@/components/RiskBadge';
import { normalizeReferralStatus } from '@/lib/referral-utils';
import { sendReferralNotification } from '@/lib/referral-notifications';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function GuidanceReferrals() {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const [reviewTarget, setReviewTarget] = useState<{ id: string; status: 'approved' | 'rejected' } | null>(null);
  const [counselorRemarks, setCounselorRemarks] = useState('');

  const {
    data: referrals = [],
    isLoading,
    error: referralsError,
  } = useCounselingReferrals();

  const reviewMutation = useMutation({
    mutationFn: async ({
      id,
      status,
      remarks,
    }: {
      id: string;
      status: 'approved' | 'rejected';
      remarks: string | null;
    }) => {
      const { error } = await supabase
        .from('counseling_referrals')
        .update({
          status,
          reviewed_at: new Date().toISOString(),
          reviewed_by: user!.id,
          counselor_remarks: remarks,
        })
        .eq('id', id);
      if (error) throw error;

      await sendReferralNotification({
        event: 'referral_decided',
        referralId: id,
        counselorRemarks: remarks,
      });
    },
    onSuccess: (_, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['guidance-referrals', user?.id] });
      void queryClient.invalidateQueries({ queryKey: ['student-counseling-referrals'] });
      void queryClient.invalidateQueries({ queryKey: ['instructor-counseling-referrals'] });
      void queryClient.invalidateQueries({ queryKey: ['counseling-referrals'] });
      toast.success(vars.status === 'approved' ? 'Referral approved' : 'Referral rejected');
      setReviewTarget(null);
      setCounselorRemarks('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pendingCount = useMemo(
    () => referrals.filter((r) => normalizeReferralStatus(r.status) === 'pending').length,
    [referrals],
  );

  const openReview = (id: string, status: 'approved' | 'rejected') => {
    setReviewTarget({ id, status });
    setCounselorRemarks('');
  };

  const confirmReview = () => {
    if (!reviewTarget) return;
    reviewMutation.mutate({
      id: reviewTarget.id,
      status: reviewTarget.status,
      remarks: counselorRemarks.trim() || null,
    });
  };

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
          ) : referralsError ? (
            <p className="text-sm text-destructive">
              Could not load referrals. {referralsError instanceof Error ? referralsError.message : 'Please try again.'}
            </p>
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
                    <div className="flex flex-wrap items-center gap-2 shrink-0 self-start">
                      {r.prediction?.risk_level ? <RiskBadge level={r.prediction.risk_level} /> : null}
                      <ReferralStatusBadge status={r.status} />
                    </div>
                  </div>

                  {r.prediction?.risk_score != null ? (
                    <p className="text-sm text-muted-foreground">
                      Risk score: <span className="font-medium text-foreground">{Number(r.prediction.risk_score).toFixed(1)}/100</span>
                    </p>
                  ) : null}

                  {r.recommendation_message ? (
                    <div>
                      <p className="text-xs font-medium text-foreground">Instructor remarks</p>
                      <p className="text-sm text-muted-foreground">{r.recommendation_message}</p>
                    </div>
                  ) : null}

                  {r.latest_feedback ? (
                    <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-medium text-foreground">Student feedback</p>
                        {r.latest_feedback.risk_level ? <RiskBadge level={r.latest_feedback.risk_level} /> : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(r.latest_feedback.reasons ?? []).slice(0, 8).map((reason) => (
                          <Badge key={reason} variant="outline" className="text-xs">{reason}</Badge>
                        ))}
                      </div>
                      {r.latest_feedback.details ? (
                        <p className="text-sm text-muted-foreground">{r.latest_feedback.details}</p>
                      ) : null}
                    </div>
                  ) : null}

                  {r.counselor_remarks ? (
                    <div>
                      <p className="text-xs font-medium text-foreground">Counselor remarks</p>
                      <p className="text-sm text-muted-foreground">{r.counselor_remarks}</p>
                    </div>
                  ) : null}

                  <p className="text-xs text-muted-foreground">
                    Requested: {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                    {r.reviewed_at ? ` · Reviewed ${new Date(r.reviewed_at).toLocaleString()}` : ''}
                  </p>

                  {normalizeReferralStatus(r.status) === 'pending' ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        onClick={() => openReview(r.id, 'approved')}
                        disabled={reviewMutation.isPending}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openReview(r.id, 'rejected')}
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

      <Dialog open={!!reviewTarget} onOpenChange={(open) => !open && setReviewTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewTarget?.status === 'approved' ? 'Approve referral' : 'Reject referral'}
            </DialogTitle>
            <DialogDescription>
              Add optional remarks for the student and instructor. They will be notified automatically by email.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="counselor-remarks">Counselor remarks (optional)</Label>
            <Textarea
              id="counselor-remarks"
              value={counselorRemarks}
              onChange={(e) => setCounselorRemarks(e.target.value)}
              placeholder="Notes or next steps for the student and instructor"
              className="min-h-[100px]"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewTarget(null)} disabled={reviewMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={confirmReview} disabled={reviewMutation.isPending}>
              {reviewMutation.isPending ? 'Saving…' : reviewTarget?.status === 'approved' ? 'Approve' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
