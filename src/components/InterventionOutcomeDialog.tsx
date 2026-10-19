import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCompleteEngagementIntervention } from '@/hooks/useEngagementAlerts';
import {
  engagementInterventionActionLabel,
  type EngagementIntervention,
  type EngagementOutcomeRating,
} from '@/lib/engagement-alerts';
import {
  OUTCOME_EMAIL_ALREADY_SENT,
  OUTCOME_SAVED_EMAIL_SENT,
  retryCounselingOutcomeEmail,
} from '@/lib/counseling-outcome-notification';

type Props = {
  intervention: EngagementIntervention | null;
  studentId: string;
  onOpenChange: (open: boolean) => void;
};

export function InterventionOutcomeDialog({
  intervention,
  studentId,
  onOpenChange,
}: Props) {
  const completeIntervention = useCompleteEngagementIntervention();
  const [rating, setRating] = useState<EngagementOutcomeRating>('improved');
  const [note, setNote] = useState('');
  const [emailFailed, setEmailFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!intervention) return;
    setRating('improved');
    setNote('');
    setEmailFailed(false);
  }, [intervention]);

  const submit = async () => {
    if (!intervention || emailFailed) return;
    try {
      const result = await completeIntervention.mutateAsync({
        interventionId: intervention.id,
        studentId,
        outcomeRating: rating,
        outcomeNote: note,
        actionType: intervention.action_type,
        actorRole: intervention.actor_role,
      });
      if (result.emailError) {
        setEmailFailed(true);
        return;
      }
      toast.success(result.alreadySent ? OUTCOME_EMAIL_ALREADY_SENT : OUTCOME_SAVED_EMAIL_SENT);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not complete follow-up');
    }
  };

  const retryEmail = async () => {
    if (!intervention) return;
    setRetrying(true);
    try {
      const result = await retryCounselingOutcomeEmail(
        intervention.id,
        intervention.action_type,
        intervention.actor_role,
      );
      if (result.emailError) {
        toast.message(result.emailError);
        return;
      }
      toast.success(result.alreadySent ? OUTCOME_EMAIL_ALREADY_SENT : OUTCOME_SAVED_EMAIL_SENT);
      onOpenChange(false);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Dialog open={!!intervention} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete intervention follow-up</DialogTitle>
          <DialogDescription>
            {emailFailed
              ? 'Outcome saved. The student email was not sent. Retry sends the email only.'
              : 'EDGE will capture the student\'s current engagement and risk metrics. Your rating records the staff assessment; it does not alter the AI risk formula.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
            <p className="font-medium">
              {intervention
                ? engagementInterventionActionLabel(intervention.action_type)
                : 'Intervention'}
            </p>
            <p className="text-muted-foreground">
              Baseline engagement:{' '}
              {intervention?.baseline_engagement_score != null
                ? Number(intervention.baseline_engagement_score).toFixed(1)
                : 'Not available'}
              {intervention?.baseline_risk_level
                ? ` · Baseline risk: ${intervention.baseline_risk_level}`
                : ''}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="intervention-outcome-rating">Staff outcome assessment</Label>
            <select
              id="intervention-outcome-rating"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={rating}
              disabled={emailFailed}
              onChange={(event) => setRating(event.target.value as EngagementOutcomeRating)}
            >
              <option value="improved">Improved</option>
              <option value="no_change">No meaningful change</option>
              <option value="declined">Declined</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="intervention-outcome-note">Staff outcome notes (optional)</Label>
            <Textarea
              id="intervention-outcome-note"
              value={note}
              disabled={emailFailed}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Describe the follow-up conversation, observed response, or next recommendation…"
              className="min-h-[100px]"
            />
            <p className="text-xs text-muted-foreground">
              These notes are available only to authorized staff.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={completeIntervention.isPending || retrying}
          >
            {emailFailed ? 'Close' : 'Cancel'}
          </Button>
          {emailFailed ? (
            <Button type="button" onClick={() => void retryEmail()} disabled={retrying}>
              {retrying ? 'Sending email…' : 'Retry student email'}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={completeIntervention.isPending}
            >
              {completeIntervention.isPending ? 'Capturing outcomes…' : 'Complete follow-up'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
