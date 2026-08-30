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

  useEffect(() => {
    if (!intervention) return;
    setRating('improved');
    setNote('');
  }, [intervention]);

  const submit = async () => {
    if (!intervention) return;
    try {
      await completeIntervention.mutateAsync({
        interventionId: intervention.id,
        studentId,
        outcomeRating: rating,
        outcomeNote: note,
      });
      toast.success('Follow-up completed and current outcomes captured.');
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not complete follow-up');
    }
  };

  return (
    <Dialog open={!!intervention} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete intervention follow-up</DialogTitle>
          <DialogDescription>
            EDGE will capture the student&apos;s current engagement and risk metrics. Your rating
            records the staff assessment; it does not alter the AI risk formula.
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
            disabled={completeIntervention.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={completeIntervention.isPending}
          >
            {completeIntervention.isPending ? 'Capturing outcomes…' : 'Complete follow-up'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
