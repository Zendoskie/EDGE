import { motion, useReducedMotion } from 'framer-motion';
import {
  BellRing,
  Check,
  ClipboardCheck,
  Flag,
  HeartPulse,
  MessageCircleMore,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  engagementOutcomeLabel,
  isInterventionFollowUpDue,
  type EngagementIntervention,
} from '@/lib/engagement-alerts';

type StepState = 'complete' | 'current' | 'upcoming' | 'attention';

type JourneyStep = {
  label: string;
  state: StepState;
  icon: typeof BellRing;
};

function buildJourney(intervention: EngagementIntervention): JourneyStep[] {
  const isCompleted = intervention.status === 'completed';
  const isDue = isInterventionFollowUpDue(intervention);
  const followUpReached = isCompleted || isDue || intervention.status === 'follow_up_due';
  const outcomeLabel = isCompleted
    ? engagementOutcomeLabel(intervention.outcome_rating)
    : 'Result';

  return [
    {
      label: intervention.alert_id ? 'Alert detected' : 'Need identified',
      state: 'complete',
      icon: BellRing,
    },
    { label: 'Action recorded', state: 'complete', icon: MessageCircleMore },
    {
      label: 'Follow-up',
      state: followUpReached ? 'complete' : 'current',
      icon: ClipboardCheck,
    },
    {
      label: 'Outcome captured',
      state: isCompleted ? 'complete' : followUpReached ? 'current' : 'upcoming',
      icon: HeartPulse,
    },
    {
      label: outcomeLabel,
      state: isCompleted
        ? intervention.outcome_rating === 'declined'
          ? 'attention'
          : 'complete'
        : 'upcoming',
      icon: Flag,
    },
  ];
}

export function InterventionJourneyTimeline({
  intervention,
}: {
  intervention: EngagementIntervention;
}) {
  const reduceMotion = useReducedMotion();
  const steps = buildJourney(intervention);
  const completedSegments = steps.reduce(
    (count, step, index) => (index < steps.length - 1 && step.state === 'complete' ? count + 1 : count),
    0,
  );
  const progress = (completedSegments / (steps.length - 1)) * 100;

  return (
    <div
      className="relative rounded-xl border border-border/50 bg-background/35 px-2 py-3 backdrop-blur-sm sm:px-3"
      aria-label="Intervention journey"
    >
      <div
        className="absolute left-[10%] right-[10%] top-[1.95rem] h-px bg-border/70"
        aria-hidden="true"
      >
        <motion.div
          className="h-full origin-left bg-gradient-to-r from-primary via-cyan-400 to-emerald-400"
          initial={reduceMotion ? false : { scaleX: 0 }}
          animate={{ scaleX: progress / 100 }}
          transition={{ duration: reduceMotion ? 0 : 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>

      <ol className="relative grid grid-cols-5 gap-1">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isCurrent = step.state === 'current';
          return (
            <li key={`${step.label}-${index}`} className="flex min-w-0 flex-col items-center gap-1.5">
              <motion.div
                className={cn(
                  'relative z-10 flex h-8 w-8 items-center justify-center rounded-full border bg-card shadow-sm',
                  step.state === 'complete' && 'border-primary/50 text-primary',
                  step.state === 'current' && 'border-amber-400/70 text-amber-600',
                  step.state === 'upcoming' && 'border-border text-muted-foreground/60',
                  step.state === 'attention' && 'border-destructive/50 text-destructive',
                )}
                initial={reduceMotion ? false : { opacity: 0, scale: 0.75 }}
                animate={
                  isCurrent && !reduceMotion
                    ? { opacity: 1, scale: [1, 1.08, 1] }
                    : { opacity: 1, scale: 1 }
                }
                transition={
                  isCurrent && !reduceMotion
                    ? { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }
                    : { delay: reduceMotion ? 0 : index * 0.07, duration: 0.28 }
                }
              >
                {step.state === 'complete' ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {isCurrent ? (
                  <span className="absolute inset-0 -z-10 rounded-full bg-amber-400/15 blur-sm" />
                ) : null}
              </motion.div>
              <span
                className={cn(
                  'max-w-full text-center text-[10px] leading-tight text-muted-foreground sm:text-xs',
                  (step.state === 'complete' || step.state === 'current') &&
                    'font-medium text-foreground',
                  step.state === 'attention' && 'font-medium text-destructive',
                )}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
