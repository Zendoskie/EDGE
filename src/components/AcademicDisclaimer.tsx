import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ACADEMIC_DISCLAIMER_FULL,
  ACADEMIC_DISCLAIMER_TITLE,
  ACADEMIC_PREDICTION_REMINDER,
} from '@/lib/academic-disclaimer';

type AcademicDisclaimerVariant = 'full' | 'banner' | 'reminder' | 'footer';

type Props = {
  variant?: AcademicDisclaimerVariant;
  className?: string;
};

export function AcademicDisclaimer({ variant = 'full', className }: Props) {
  if (variant === 'reminder') {
    return (
      <p
        className={cn('text-xs text-muted-foreground italic leading-relaxed text-pretty', className)}
        role="note"
      >
        {ACADEMIC_PREDICTION_REMINDER}
      </p>
    );
  }

  if (variant === 'footer') {
    return (
      <aside
        className={cn(
          'mt-6 rounded-lg border border-border/60 bg-muted/30 px-3 py-3 sm:px-4',
          className,
        )}
        role="note"
        aria-label={ACADEMIC_DISCLAIMER_TITLE}
      >
        <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed text-pretty">
          {ACADEMIC_DISCLAIMER_FULL}
        </p>
      </aside>
    );
  }

  if (variant === 'banner') {
    return (
      <div
        className={cn(
          'mb-4 rounded-lg border border-border/60 bg-card/85 px-3 py-2.5 sm:px-4 sm:py-3 shadow-sm',
          className,
        )}
        role="note"
        aria-label={ACADEMIC_DISCLAIMER_TITLE}
      >
        <div className="flex gap-2 sm:gap-3 min-w-0">
          <Info className="h-4 w-4 shrink-0 text-primary mt-0.5" aria-hidden />
          <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed text-pretty min-w-0 flex-1">
            {ACADEMIC_DISCLAIMER_FULL}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-border/60 bg-muted/25 px-3 py-3 sm:px-4 sm:py-3.5 min-w-0',
        className,
      )}
      role="note"
      aria-label={ACADEMIC_DISCLAIMER_TITLE}
    >
      <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed text-pretty">
        <span className="font-medium text-foreground">{ACADEMIC_DISCLAIMER_TITLE}. </span>
        {ACADEMIC_DISCLAIMER_FULL}
      </p>
    </div>
  );
}
