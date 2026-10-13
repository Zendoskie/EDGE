import { Badge } from '@/components/ui/badge';
import { finalGradeStatus, type FinalGradeReleaseRow } from '@/lib/final-grade-status';
import { formatGradePercent } from '@/lib/weighted-grading';

/**
 * Provisional / Final / Under review from the release row. The provisional weighted grade is
 * always labelled provisional; a needs_review row never shows a number from the release.
 */
export function FinalGradeBadge({
  release,
  provisionalGrade,
  loading = false,
  error = false,
  className = 'text-xs',
}: {
  release: FinalGradeReleaseRow | null | undefined;
  provisionalGrade: number | null | undefined;
  loading?: boolean;
  error?: boolean;
  className?: string;
}) {
  const provisional =
    provisionalGrade != null ? (
      <Badge variant="secondary" className={className}>
        Provisional weighted: {formatGradePercent(provisionalGrade)}
      </Badge>
    ) : null;

  if (loading || error) {
    return (
      <>
        <Badge variant="outline" className={className}>Status unavailable</Badge>
        {provisional}
      </>
    );
  }

  const status = finalGradeStatus(release);
  if (status.kind === 'final') {
    return <Badge className={className}>Final {formatGradePercent(status.grade)}</Badge>;
  }
  if (status.kind === 'under_review') {
    return (
      <>
        <Badge variant="outline" className={`${className} border-amber-500/60 text-amber-700 dark:text-amber-400`}>
          Under review
        </Badge>
        {provisional}
      </>
    );
  }
  return (
    <>
      <Badge variant="outline" className={className}>Provisional</Badge>
      {provisional}
    </>
  );
}
