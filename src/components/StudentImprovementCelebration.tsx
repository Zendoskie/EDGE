import { motion, useReducedMotion } from 'framer-motion';
import { Sparkles, TrendingUp, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { canonicalEngagementLevel, type CanonicalEngagementLevel } from '@/lib/engagement-utils';

const LEVEL_RANK: Record<CanonicalEngagementLevel, number> = {
  low: 0,
  moderate: 1,
  high: 2,
  very_high: 3,
};

const SPARKLES = [
  { left: '9%', top: '24%', delay: 0 },
  { left: '22%', top: '70%', delay: 0.18 },
  { left: '68%', top: '18%', delay: 0.1 },
  { left: '84%', top: '62%', delay: 0.28 },
  { left: '94%', top: '28%', delay: 0.4 },
];

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
      className="edge-celebration relative overflow-hidden rounded-2xl border border-emerald-400/30 bg-gradient-to-br from-emerald-500/12 via-cyan-500/8 to-primary/10 p-4 shadow-[0_18px_55px_-35px_hsl(var(--success)/0.85)] backdrop-blur-xl sm:p-5"
      role="status"
      aria-live="polite"
      initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {!reduceMotion
        ? SPARKLES.map((sparkle, index) => (
            <motion.span
              key={`${sparkle.left}-${sparkle.top}`}
              className="absolute text-emerald-400/70"
              style={{ left: sparkle.left, top: sparkle.top }}
              initial={{ opacity: 0, scale: 0, rotate: -20 }}
              animate={{
                opacity: [0, 1, 0],
                scale: [0.5, 1, 0.75],
                rotate: [-20, 12, 30],
              }}
              transition={{
                delay: sparkle.delay,
                duration: 1.5,
                repeat: 1,
                repeatDelay: 0.45,
              }}
              aria-hidden="true"
            >
              <Sparkles className={index % 2 ? 'h-3 w-3' : 'h-4 w-4'} />
            </motion.span>
          ))
        : null}

      <div className="relative flex items-start gap-3 pr-9">
        <motion.div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
          initial={reduceMotion ? false : { rotate: -8, scale: 0.8 }}
          animate={{ rotate: 0, scale: 1 }}
          transition={{ delay: reduceMotion ? 0 : 0.15, type: 'spring', stiffness: 220 }}
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
