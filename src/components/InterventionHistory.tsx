import { useState } from 'react';
import { CalendarClock, CheckCircle2, History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { InterventionOutcomeDialog } from '@/components/InterventionOutcomeDialog';
import { InterventionJourneyTimeline } from '@/components/InterventionJourneyTimeline';
import { AnimatedNumber } from '@/components/motion/AnimatedNumber';
import {
  engagementInterventionActionLabel,
  engagementOutcomeLabel,
  interventionStatusLabel,
  isInterventionFollowUpDue,
  type EngagementIntervention,
} from '@/lib/engagement-alerts';
import { formatLastLogin } from '@/lib/engagement-format';

type Props = {
  studentId: string;
  interventions: EngagementIntervention[];
  isLoading?: boolean;
  currentUserId?: string;
  isAdmin?: boolean;
};

function staffOutcomeNote(intervention: EngagementIntervention): string | null {
  const relation = intervention.intervention_staff_outcomes;
  if (Array.isArray(relation)) return relation[0]?.outcome_note ?? null;
  return relation?.outcome_note ?? null;
}

function statusVariant(
  intervention: EngagementIntervention,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (intervention.status === 'completed') return 'default';
  if (isInterventionFollowUpDue(intervention)) return 'destructive';
  if (intervention.status === 'cancelled') return 'outline';
  return 'secondary';
}

function AnimatedDelta({
  value,
  suffix = '',
}: {
  value: number | null;
  suffix?: string;
}) {
  if (value == null) return <span>—</span>;
  const numericValue = Number(value);
  return (
    <AnimatedNumber
      value={numericValue}
      decimals={Number.isInteger(numericValue) ? 0 : 1}
      prefix={numericValue > 0 ? '+' : ''}
      suffix={suffix}
    />
  );
}

export function InterventionHistory({
  studentId,
  interventions,
  isLoading,
  currentUserId,
  isAdmin,
}: Props) {
  const [completionTarget, setCompletionTarget] = useState<EngagementIntervention | null>(null);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <History className="h-4 w-4 text-primary" />
        <p className="text-sm font-medium">Intervention follow-ups</p>
      </div>

      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : interventions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No engagement interventions logged yet.</p>
      ) : (
        <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
          {interventions.map((item) => {
            const canComplete =
              item.status !== 'completed' &&
              item.status !== 'cancelled' &&
              (isAdmin || item.instructor_id === currentUserId);
            const due = isInterventionFollowUpDue(item);
            const outcomeNote = staffOutcomeNote(item);

            return (
              <div key={item.id} className="edge-glass-card space-y-3 rounded-xl border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {engagementInterventionActionLabel(item.action_type)}
                    </Badge>
                    <Badge variant={statusVariant(item)}>
                      {due && item.status === 'open'
                        ? 'Follow-up due'
                        : interventionStatusLabel(item.status)}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatLastLogin(item.created_at)}
                  </span>
                </div>

                {item.note ? <p className="text-sm text-muted-foreground">{item.note}</p> : null}

                <InterventionJourneyTimeline intervention={item} />

                <div className="grid gap-2 text-xs sm:grid-cols-2">
                  <div className="rounded-md bg-muted/35 p-2">
                    <p className="font-medium text-foreground">Baseline</p>
                    <p className="text-muted-foreground">
                      Engagement:{' '}
                      {item.baseline_engagement_score != null
                        ? Number(item.baseline_engagement_score).toFixed(1)
                        : '—'}
                      {item.baseline_engagement_level
                        ? ` (${item.baseline_engagement_level.replace(/_/g, ' ')})`
                        : ''}
                    </p>
                    <p className="text-muted-foreground">
                      Risk:{' '}
                      {item.baseline_risk_level
                        ? `${item.baseline_risk_level}${
                            item.baseline_risk_score != null
                              ? ` (${Number(item.baseline_risk_score).toFixed(1)})`
                              : ''
                          }`
                        : '—'}
                    </p>
                  </div>

                  <div className="rounded-md bg-muted/35 p-2">
                    <p className="font-medium text-foreground">Outcome</p>
                    {item.status === 'completed' ? (
                      <>
                        <p className="text-muted-foreground">
                          Engagement:{' '}
                          <AnimatedDelta value={item.engagement_score_delta} suffix=" points" />
                        </p>
                        <p className="text-muted-foreground">
                          Risk score: <AnimatedDelta value={item.risk_score_delta} suffix=" points" />
                        </p>
                        <p className="text-muted-foreground">
                          Logins: <AnimatedDelta value={item.login_count_delta} />
                          {' · '}Assignments: <AnimatedDelta value={item.assignments_submitted_delta} />
                        </p>
                      </>
                    ) : (
                      <p className="text-muted-foreground">Waiting for follow-up review</p>
                    )}
                  </div>
                </div>

                {item.status === 'completed' ? (
                  <div className="space-y-1 rounded-md border border-primary/20 bg-primary/5 p-2 text-xs">
                    <p className="flex items-center gap-1.5 font-medium text-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                      Staff assessment: {engagementOutcomeLabel(item.outcome_rating)}
                    </p>
                    {outcomeNote ? <p className="text-muted-foreground">{outcomeNote}</p> : null}
                  </div>
                ) : item.follow_up_due_at ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarClock className="h-3.5 w-3.5" />
                    Follow-up {due ? 'was due' : 'due'}{' '}
                    {new Date(item.follow_up_due_at).toLocaleString()}
                  </p>
                ) : null}

                {canComplete ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={due ? 'default' : 'outline'}
                    onClick={() => setCompletionTarget(item)}
                  >
                    Complete follow-up
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <InterventionOutcomeDialog
        intervention={completionTarget}
        studentId={studentId}
        onOpenChange={(open) => {
          if (!open) setCompletionTarget(null);
        }}
      />
    </div>
  );
}
