import { motion, useReducedMotion } from 'framer-motion';
import { TrendingUp, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { canonicalEngagementLevel, type CanonicalEngagementLevel } from '@/lib/engagement-utils';

const LEVEL_RANK: Record<CanonicalEngagementLevel, number> = {
  low: 0,
  moderate: 1,
  high: 2,
  very_high: 3,
};

type Props = {
  studentId: string;
  currentScore: number;
  previousScore: number | null;
  currentLevel: string;
  previousLevel: string | null;
};

export function StudentImprovementCelebration({
  studentId,
  currentScore,
  previousScore,
  currentLevel,
  previousLevel,
}: Props) {
  const reduceMotion = useReducedMotion();
  const scoreDelta = previousScore == null ? 0 : currentScore - previousScore;
  const levelImproved =
    previousLevel != null &&
    LEVEL_RANK[canonicalEngagementLevel(currentLevel)] >
      LEVEL_RANK[canonicalEngagementLevel(previousLevel)];
  const shouldCelebrate = scoreDelta >= 5 || levelImproved;
  const storageKey = useMemo(
    () =>
      `edge-engagement-celebration:${studentId}:${previousScore ?? 'new'}-${currentScore}:${previousLevel ?? 'new'}-${currentLevel}`,
    [currentLevel, currentScore, previousLevel, previousScore, studentId],
  );
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!shouldCelebrate) {
      setVisible(false);
      return;
    }
    const alreadySeen = window.sessionStorage.getItem(storageKey) === 'seen';
    setVisible(!alreadySeen);
  }, [shouldCelebrate, storageKey]);

  if (!visible) return null;

  const dismiss = () => {
    window.sessionStorage.setItem(storageKey, 'seen');
    setVisible(false);
  };

  return (
    <motion.aside
      className="relative overflow-hidden rounded-lg border border-success/30 bg-card p-4 sm:p-5"
      role="status"
      aria-live="polite"
      initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="relative flex items-start gap-3 pr-9">
        <motion.div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-success/30 bg-success/10 text-success"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.2 }}
        >
          <TrendingUp className="h-5 w-5" aria-hidden="true" />
        </motion.div>
        <div>
          <p className="font-display text-lg font-semibold text-foreground">
            Your consistency is making a difference
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {scoreDelta >= 5
              ? `Your engagement increased by ${Math.round(scoreDelta * 10) / 10} points.`
              : 'You moved to a higher engagement level.'}{' '}
            Keep building on the small actions that worked.
          </p>
        </div>
      </div>

      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="absolute right-2 top-2 h-8 w-8"
        onClick={dismiss}
        aria-label="Dismiss improvement message"
      >
        <X className="h-4 w-4" />
      </Button>
    </motion.aside>
  );
}
