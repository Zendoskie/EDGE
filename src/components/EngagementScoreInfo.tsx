import { useMemo } from 'react';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  parentEngagementExplanation,
  studentEngagementExplanation,
  type EngagementExplanation,
} from '@/lib/engagement-descriptions';

type Props = {
  variant: 'student' | 'parent';
  className?: string;
  label?: string;
};

/**
 * "How this is computed" dialog for the student engagement score and the parent
 * check-in engagement score. Copy is generated from the same config the scoring
 * uses, so the explanation cannot drift from the formula.
 */
export function EngagementScoreInfo({ variant, className, label = 'How this is computed' }: Props) {
  const explanation: EngagementExplanation = useMemo(
    () => (variant === 'parent' ? parentEngagementExplanation() : studentEngagementExplanation()),
    [variant],
  );

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground', className)}
          aria-label={explanation.title}
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{explanation.title}</DialogTitle>
          <DialogDescription>{explanation.summary}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <p className="text-xs text-muted-foreground">
            Rolling window: the last {explanation.windowDays} days. Each signal is scored 0–100.
          </p>

          <ul className="space-y-2">
            {explanation.pillars.map((pillar) => (
              <li key={pillar.key} className="rounded-lg border border-border/60 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{pillar.label}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {pillar.weightPercent}% of score
                  </span>
                </div>
                <p className="mt-0.5 text-xs font-medium text-foreground/80">{pillar.target}</p>
                <p className="mt-1 text-xs text-muted-foreground">{pillar.detail}</p>
              </li>
            ))}
          </ul>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Level bands
            </p>
            <ul className="mt-1.5 space-y-1">
              {explanation.levels.map((level) => (
                <li key={level.label} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-xs">
                  <span className="font-medium">
                    {level.label} ({level.minimum}+)
                  </span>
                  <span className="text-right text-muted-foreground">{level.description}</span>
                </li>
              ))}
            </ul>
          </div>

          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {explanation.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
