import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FinalGradeBadge } from '@/components/FinalGradeBadge';
import { useSubjectFinalGradeReleases } from '@/hooks/useFinalGradeReleases';
import { subjectReleaseKey } from '@/lib/final-grade-freshness';
import { missingItemLabel, reviewReasonLabel, type MissingItem } from '@/lib/final-grade-status';
import { invokeReleaseFinalGrades, type ReleaseCallResult } from '@/lib/invoke-release-final-grades';

export type ReleasePreview = { complete: boolean; missing: MissingItem[]; provisionalGrade: number | null };

const MAX_LISTED_MISSING = 3;

function MissingList({ missing }: { missing: MissingItem[] }) {
  const shown = missing.slice(0, MAX_LISTED_MISSING);
  return (
    <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
      {shown.map((item, i) => (
        <li key={i}>{missingItemLabel(item)}</li>
      ))}
      {missing.length > shown.length ? <li>+{missing.length - shown.length} more</li> : null}
    </ul>
  );
}

/**
 * Instructor final-grade release. The preview uses the shared completeness helper on saved
 * gradebook data; the release-final-grades function rechecks everything and is authoritative.
 */
export function FinalGradeReleasePanel({
  subjectId,
  students,
  preview,
  hasUnsavedDrafts,
  previewMayBeIncomplete,
}: {
  subjectId: string;
  students: Array<{ id: string; name: string }>;
  preview: Map<string, ReleasePreview> | null;
  hasUnsavedDrafts: boolean;
  previewMayBeIncomplete: boolean;
}) {
  const queryClient = useQueryClient();
  const releases = useSubjectFinalGradeReleases(subjectId);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ReleaseCallResult | null>(null);
  const [included, setIncluded] = useState<Set<string>>(() => new Set());
  const [lastExcludedCount, setLastExcludedCount] = useState(0);

  const releaseByStudent = useMemo(
    () => new Map((releases.data ?? []).map((row) => [row.student_id, row])),
    [releases.data],
  );
  const nameById = useMemo(() => new Map(students.map((s) => [s.id, s.name])), [students]);

  const completeStudentIds = useMemo(() => {
    if (!preview) return [];
    return students.filter((s) => preview.get(s.id)?.complete).map((s) => s.id);
  }, [students, preview]);

  const incompleteCount = preview ? students.length - completeStudentIds.length : null;

  useEffect(() => {
    if (!preview) return;
    const complete = new Set(completeStudentIds);
    setIncluded((prev) => {
      if (prev.size === 0 && complete.size > 0) return complete;
      const next = new Set<string>();
      for (const id of prev) {
        if (complete.has(id)) next.add(id);
      }
      for (const id of complete) {
        if (!prev.has(id)) next.add(id);
      }
      return next.size > 0 ? next : complete;
    });
  }, [preview, completeStudentIds]);

  const selectedCount = included.size;
  const excludedCompleteCount = completeStudentIds.filter((id) => !included.has(id)).length;
  const allCompleteSelected =
    completeStudentIds.length > 0 && completeStudentIds.every((id) => included.has(id));

  const toggleIncluded = (studentId: string, checked: boolean) => {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (checked) next.add(studentId);
      else next.delete(studentId);
      return next;
    });
  };

  const selectAllComplete = () => setIncluded(new Set(completeStudentIds));
  const clearSelection = () => setIncluded(new Set());

  const releaseDisabled = pending || hasUnsavedDrafts || selectedCount === 0;

  const release = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setResult(null);
    const studentIds = [...included];
    setLastExcludedCount(excludedCompleteCount);
    try {
      const outcome = await invokeReleaseFinalGrades(subjectId, { studentIds });
      setResult(outcome);
      if (outcome.kind !== 'error') {
        await queryClient.invalidateQueries({ queryKey: subjectReleaseKey(subjectId) });
      }
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const confirmDescription = () => {
    if (preview == null) {
      return 'The server checks each selected student and releases only complete grades. Released grades show as Final to students and parents.';
    }
    const parts = [
      `Release final grades for ${selectedCount} of ${students.length} enrolled students.`,
    ];
    if (excludedCompleteCount > 0) {
      parts.push(`${excludedCompleteCount} complete student${excludedCompleteCount === 1 ? '' : 's'} excluded from this run.`);
    }
    if (incompleteCount != null && incompleteCount > 0) {
      parts.push(`${incompleteCount} incomplete (not eligible).`);
    }
    parts.push('The server rechecks each selected student. Released grades show as Final to students and parents.');
    return parts.join(' ');
  };

  return (
    <section className="space-y-3 rounded-lg border border-border/70 bg-muted/10 p-4" aria-label="Final grade release">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Final grade release</p>
          <p className="text-xs text-muted-foreground">
            Students and parents see a grade as Final only after you release it. Grades stay Provisional until then, and
            show Under review if scores, attendance, assessments or weights change after release. Uncheck a student to
            exclude them from this release; their saved grades stay in the gradebook.
          </p>
          {preview && completeStudentIds.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {selectedCount} of {completeStudentIds.length} complete students selected for release.
            </p>
          ) : null}
          {previewMayBeIncomplete ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Preview may be incomplete; the server rechecks every selected student when you release.
            </p>
          ) : null}
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" disabled={releaseDisabled}>
              <Send className="mr-2 h-4 w-4" />
              {pending ? 'Releasing...' : 'Release final grades'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Release final grades?</AlertDialogTitle>
              <AlertDialogDescription>{confirmDescription()}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void release()} disabled={pending}>
                Release
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {hasUnsavedDrafts ? (
        <p className="text-xs text-muted-foreground">Save grades first. Unsaved cells are not part of a release.</p>
      ) : null}
      {preview && completeStudentIds.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={selectAllComplete} disabled={allCompleteSelected}>
            Select all complete
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={clearSelection} disabled={selectedCount === 0}>
            Clear selection
          </Button>
        </div>
      ) : null}

      {result?.kind === 'conflict' ? (
        <Alert variant="destructive">
          <AlertTitle>Nothing was released</AlertTitle>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      ) : null}
      {result?.kind === 'error' ? (
        <Alert variant="destructive">
          <AlertTitle>Release failed</AlertTitle>
          <AlertDescription>{result.message} No grades are shown as released from this attempt.</AlertDescription>
        </Alert>
      ) : null}
      {result?.kind === 'ok' ? (
        <Alert>
          <AlertTitle>
            {result.body.outcome === 'all_released'
              ? 'Every selected student has a released final grade'
              : result.body.outcome === 'partial'
                ? 'Some final grades were released'
                : 'No final grades were released'}
          </AlertTitle>
          <AlertDescription>
            <p>
              {result.body.released} released, {result.body.unchanged} already final and unchanged,{' '}
              {result.body.incomplete.length} incomplete among selected, {result.body.not_enrolled.length} not enrolled.
              {lastExcludedCount > 0
                ? ` ${lastExcludedCount} complete student${lastExcludedCount === 1 ? ' was' : 's were'} excluded from this run and remain Provisional.`
                : null}
            </p>
            {result.body.incomplete.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {result.body.incomplete.map((row) => (
                  <li key={row.student_id}>
                    <span className="font-medium">{nameById.get(row.student_id) ?? 'Unknown student'}</span>
                    <MissingList missing={row.missing} />
                  </li>
                ))}
              </ul>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="overflow-auto rounded-md border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[72px]">Include</TableHead>
              <TableHead>Student</TableHead>
              <TableHead>Preview</TableHead>
              <TableHead>Release status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {students.map((student) => {
              const p = preview?.get(student.id);
              const row = releaseByStudent.get(student.id);
              const canInclude = Boolean(p?.complete);
              const isIncluded = included.has(student.id);
              return (
                <TableRow key={student.id}>
                  <TableCell className="align-top">
                    <Checkbox
                      checked={canInclude && isIncluded}
                      disabled={!canInclude || pending}
                      onCheckedChange={(checked) => toggleIncluded(student.id, checked === true)}
                      aria-label={`Include ${student.name} in final grade release`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{student.name}</TableCell>
                  <TableCell className="align-top">
                    {!p ? (
                      <span className="text-xs text-muted-foreground">Checking...</span>
                    ) : p.complete ? (
                      <Badge variant="outline" className="text-xs">Complete</Badge>
                    ) : (
                      <>
                        <Badge variant="secondary" className="text-xs">{p.missing.length} required missing</Badge>
                        <MissingList missing={p.missing} />
                      </>
                    )}
                    {canInclude && !isIncluded ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">Excluded from this release</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-wrap items-center gap-1">
                      <FinalGradeBadge
                        release={row ?? null}
                        provisionalGrade={p?.provisionalGrade ?? null}
                        loading={releases.isLoading}
                        error={releases.isError}
                      />
                    </div>
                    {row && row.status === 'needs_review' ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">{reviewReasonLabel(row.review_reason)}</p>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
