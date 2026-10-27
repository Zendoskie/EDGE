import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { formatAssessmentTypeLabel } from '@/lib/assessment-types';
import {
  classifyGradeInput,
  collectGradeChanges,
  countMissingGrades,
  gradeCellKey,
  gradesPostedItemsFromSavedScores,
  sortGradebookActivities,
  type GradebookActivity,
} from '@/lib/gradebook';
import {
  emailGradesPosted,
  GRADES_EMAIL_ALREADY_SENT,
  GRADES_EMAIL_FAILED,
} from '@/lib/grades-posted-notification';
import { publishMissingGradeAlerts } from '@/lib/missing-grade-notifications';
import { recalculateSubjectRisk } from '@/lib/recalculate-risk';
import { subjectReleaseKey } from '@/lib/final-grade-freshness';
import { missingItemLabel } from '@/lib/final-grade-status';
import { gradeItemPercent } from '@/lib/weighted-grading';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { FinalGradeReleasePanel, type ReleasePreview } from '@/components/FinalGradeReleasePanel';
import {
  computeReleaseGrade,
  effectiveWeights,
  evaluateGradeCompleteness,
  type ReleaseActivity,
  type ReleaseSubmission,
} from '../../supabase/functions/_shared/final-grade-release.ts';
import type { GradeWeights } from '../../supabase/functions/_shared/weighted-grading.ts';
import type { EnrollmentListRow } from '@/types/dashboard';

type SubmissionRow = {
  id: string;
  activity_id: string | null;
  student_id: string | null;
  score: number | null;
  assessment_type: string | null;
};

/** PostgREST max rows: a list this long may be truncated, so the release preview says so. */
const MAX_ROWS = 1000;

type ActivityRow = {
  id: string;
  title: string;
  type: string;
  max_score: number;
  subject_id: string | null;
  created_at: string | null;
};

export function GradebookTable({
  subjectId,
  userId,
  activities,
  gradingSystem,
  attendance,
}: {
  subjectId: string;
  userId?: string;
  activities: ActivityRow[];
  /** Saved weights; null means the defaults apply, undefined means still loading. */
  gradingSystem?: GradeWeights | null;
  /** The subject's attendance rows; undefined means still loading. */
  attendance?: Array<{ student_id: string | null; status: string }>;
}) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const columns = useMemo(
    () =>
      sortGradebookActivities(
        activities
          .filter((activity) => activity.subject_id === subjectId)
          .map(
            (activity): GradebookActivity => ({
              id: activity.id,
              title: activity.title,
              type: activity.type,
              maxScore: Number(activity.max_score),
              subjectId: activity.subject_id,
              createdAt: activity.created_at,
            }),
          ),
      ),
    [activities, subjectId],
  );

  const activityIds = columns.map((activity) => activity.id);

  const { data: enrollments = [], isLoading: enrollmentsLoading } = useQuery<EnrollmentListRow[]>({
    queryKey: ['enrollments', subjectId, 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enrollments')
        .select('*')
        .eq('subject_id', subjectId)
        .eq('status', 'active');
      if (error) throw error;
      if (!data.length) return [];
      const studentIds = data.map((row) => row.student_id).filter(Boolean) as string[];
      const { data: profiles } = await supabase.from('profiles').select('*').in('user_id', studentIds);
      return data.map((row) => ({
        ...row,
        profile: profiles?.find((profile) => profile.user_id === row.student_id),
      })) as EnrollmentListRow[];
    },
  });

  const students = useMemo(
    () =>
      [...enrollments]
        .filter((row) => row.status === 'active' && typeof row.student_id === 'string' && row.student_id.length > 0)
        .sort((a, b) =>
          (a.profile?.full_name || '').localeCompare(b.profile?.full_name || '', undefined, { sensitivity: 'base' }),
        ),
    [enrollments],
  );

  const { data: submissions = [], isLoading: submissionsLoading } = useQuery({
    queryKey: ['gradebook-submissions', subjectId, activityIds.join(',')],
    queryFn: async () => {
      if (activityIds.length === 0) return [] as SubmissionRow[];
      const { data, error } = await supabase
        .from('submissions')
        .select('id, activity_id, student_id, score, assessment_type')
        .in('activity_id', activityIds);
      if (error) throw error;
      return (data ?? []) as SubmissionRow[];
    },
    enabled: activityIds.length > 0,
  });

  const savedScores = useMemo(() => {
    const scores: Record<string, number | null> = {};
    for (const row of submissions) {
      if (!row.student_id || !row.activity_id) continue;
      const key = gradeCellKey(row.student_id, row.activity_id);
      if (key in scores) continue;
      scores[key] = row.score;
    }
    return scores;
  }, [submissions]);

  const savedAssessmentTypes = useMemo(() => {
    const types: Record<string, string | null> = {};
    for (const row of submissions) {
      if (!row.student_id || !row.activity_id) continue;
      const key = gradeCellKey(row.student_id, row.activity_id);
      if (key in types) continue;
      types[key] = row.assessment_type;
    }
    return types;
  }, [submissions]);

  const enrolledIds = useMemo(() => students.map((student) => student.student_id), [students]);
  const missingCount = countMissingGrades({
    enrolledStudentIds: enrolledIds,
    activityIds,
    savedScores,
    drafts,
  });

  // Saved data only: drafts are not grades until saved, and a blank cell is never a zero.
  const releasePreview = useMemo((): Map<string, ReleasePreview> | null => {
    if (gradingSystem === undefined || attendance === undefined) return null;
    const releaseActivities: ReleaseActivity[] = columns.map((c) => ({
      id: c.id,
      title: c.title,
      type: c.type,
      max_score: c.maxScore,
    }));
    const subsByStudent = new Map<string, Map<string, ReleaseSubmission>>();
    for (const row of submissions) {
      if (!row.student_id || !row.activity_id) continue;
      if (!subsByStudent.has(row.student_id)) subsByStudent.set(row.student_id, new Map());
      subsByStudent.get(row.student_id)!.set(row.activity_id, {
        student_id: row.student_id,
        activity_id: row.activity_id,
        score: row.score,
        assessment_type: row.assessment_type,
      });
    }
    const statusesByStudent = new Map<string, string[]>();
    for (const row of attendance) {
      if (!row.student_id) continue;
      if (!statusesByStudent.has(row.student_id)) statusesByStudent.set(row.student_id, []);
      statusesByStudent.get(row.student_id)!.push(row.status);
    }
    const weights = effectiveWeights(gradingSystem);
    const result = new Map<string, ReleasePreview>();
    for (const studentId of enrolledIds) {
      const input = {
        activities: releaseActivities,
        submissionsByActivity: subsByStudent.get(studentId) ?? new Map<string, ReleaseSubmission>(),
        attendanceStatuses: statusesByStudent.get(studentId) ?? [],
      };
      const { complete, missing } = evaluateGradeCompleteness({ ...input, weights });
      result.set(studentId, {
        complete,
        missing,
        provisionalGrade: computeReleaseGrade({ ...input, savedWeights: gradingSystem }),
      });
    }
    return result;
  }, [gradingSystem, attendance, columns, submissions, enrolledIds]);

  const hasUnsavedDrafts = Object.entries(drafts).some(
    ([key, value]) => value.trim() !== (savedScores[key] != null ? String(savedScores[key]) : ''),
  );
  const previewMayBeIncomplete = submissions.length >= MAX_ROWS || (attendance?.length ?? 0) >= MAX_ROWS;

  const saveGrades = useMutation({
    mutationFn: async () => {
      const enrolledStudentIds = new Set(enrolledIds);
      const { changes, invalid, skippedClears } = collectGradeChanges({
        subjectId,
        enrolledStudentIds,
        activities: columns,
        savedScores,
        drafts,
      });

      if (invalid.length > 0) {
        throw new Error(invalid.slice(0, 3).join(' '));
      }
      if (changes.length === 0) {
        return { saved: 0, skippedClears };
      }

      const rows = changes.map((change) => ({
        activity_id: change.activityId,
        student_id: change.studentId,
        score: change.score,
        assessment_type: change.assessmentType,
        graded_by: userId ?? null,
        graded_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from('submissions')
        .upsert(rows, { onConflict: 'activity_id,student_id' });
      if (error) throw error;

      const emailed = await emailGradesPosted(
        subjectId,
        changes.map((change) => ({
          activity_id: change.activityId,
          student_id: change.studentId,
        })),
      );
      if (emailed.emailError) {
        toast.message('Grade saved. The email notification could not be sent.');
      }

      try {
        await publishMissingGradeAlerts(
          subjectId,
          changes.map((change) => change.activityId),
        );
      } catch {
        toast.message('Grades saved. Missing-grade notifications could not be created.');
      }

      return { saved: rows.length, skippedClears };
    },
    onSuccess: async (result) => {
      setDrafts({});
      await queryClient.invalidateQueries({ queryKey: ['gradebook-submissions', subjectId] });
      if (result?.saved) void queryClient.invalidateQueries({ queryKey: subjectReleaseKey(subjectId) });
      if (!result || result.saved === 0) {
        if (result?.skippedClears) {
          toast.message('No grades saved. Blank cells do not clear existing grades.');
        } else {
          toast.message('No grade changes to save.');
        }
        return;
      }
      toast.success(result.saved === 1 ? '1 grade saved' : `${result.saved} grades saved`);
      if (result.skippedClears > 0) {
        toast.message('Blank cells were left unchanged so existing grades were not cleared.');
      }
      const risk = await recalculateSubjectRisk(subjectId);
      if (risk.ok) {
        queryClient.invalidateQueries({ queryKey: ['predictions', subjectId] });
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const retryGradeEmails = useMutation({
    mutationFn: async () => {
      const items = gradesPostedItemsFromSavedScores({
        subjectId,
        enrolledStudentIds: new Set(enrolledIds),
        activities: columns,
        savedScores,
      });
      if (items.length === 0) {
        return { emailError: null as string | null, alreadySent: false, empty: true };
      }
      const result = await emailGradesPosted(subjectId, items);
      return { ...result, empty: false };
    },
    onSuccess: (result) => {
      if (result.empty) {
        toast.message('No saved scores to email yet.');
        return;
      }
      if (result.emailError) {
        toast.message(result.emailError === GRADES_EMAIL_FAILED ? GRADES_EMAIL_FAILED : result.emailError);
        return;
      }
      toast.success(result.alreadySent ? GRADES_EMAIL_ALREADY_SENT : 'Grade emails sent.');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (enrollmentsLoading || submissionsLoading) {
    return <p className="px-4 py-3 text-sm text-muted-foreground">Loading gradebook...</p>;
  }

  if (students.length === 0) {
    return <p className="px-4 py-3 text-sm text-muted-foreground">Enroll students first to input scores.</p>;
  }

  if (columns.length === 0) {
    return <p className="px-4 py-3 text-sm text-muted-foreground">Add an assessment to start grading.</p>;
  }

  return (
    <div className="space-y-3 px-4 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={missingCount > 0 ? 'secondary' : 'outline'}>
            {missingCount === 0 ? 'No blank cells' : `${missingCount} blank ${missingCount === 1 ? 'cell' : 'cells'}`}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Enter a score from 0 through each assessment&apos;s max. Empty cells stay unsaved.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => retryGradeEmails.mutate()}
            disabled={retryGradeEmails.isPending || saveGrades.isPending}
          >
            {retryGradeEmails.isPending ? 'Retrying email…' : 'Retry grade emails'}
          </Button>
          <Button size="sm" onClick={() => saveGrades.mutate()} disabled={saveGrades.isPending}>
            <Save className="mr-2 h-4 w-4" />
            {saveGrades.isPending ? 'Saving...' : 'Save grades'}
          </Button>
        </div>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border/70">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-20 min-w-[160px] bg-card">Student</TableHead>
              {columns.map((activity) => (
                <TableHead key={activity.id} className="min-w-[140px] align-bottom">
                  <div className="space-y-1 py-1">
                    <p className="font-medium text-foreground leading-tight">{activity.title}</p>
                    <p className="text-[11px] font-normal text-muted-foreground">
                      {formatAssessmentTypeLabel(activity.type)} · / {activity.maxScore}
                    </p>
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {students.map((student) => (
              <TableRow key={student.student_id}>
                <TableCell className="sticky left-0 z-10 bg-card font-medium">
                  <div className="max-w-[180px] truncate">{student.profile?.full_name || '—'}</div>
                  {student.profile?.student_id ? (
                    <p className="text-[11px] font-normal text-muted-foreground truncate">{student.profile.student_id}</p>
                  ) : null}
                  <RequiredGradesIndicator
                    name={student.profile?.full_name || 'Student'}
                    preview={releasePreview?.get(student.student_id)}
                  />
                </TableCell>
                {columns.map((activity) => {
                  const key = gradeCellKey(student.student_id, activity.id);
                  const saved = savedScores[key];
                  const raw = drafts[key] ?? (saved != null ? String(saved) : '');
                  const classified = classifyGradeInput(raw, activity.maxScore);
                  const missing = classified.status === 'empty';
                  const invalid = classified.status === 'invalid';
                  return (
                    <TableCell key={activity.id} className="align-top">
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={activity.maxScore}
                        step="any"
                        aria-label={`${student.profile?.full_name || 'Student'} ${activity.title}`}
                        placeholder="Missing"
                        value={raw}
                        onChange={(event) =>
                          setDrafts((prev) => ({ ...prev, [key]: event.target.value }))
                        }
                        className={`h-8 w-full min-w-[88px] ${
                          invalid
                            ? 'border-destructive focus-visible:ring-destructive'
                            : missing
                              ? 'border-amber-500/60'
                              : ''
                        }`}
                      />
                      <p className={`mt-1 text-[10px] ${invalid ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {invalid
                          ? classified.message
                          : classified.status === 'valid'
                            ? `${(
                                gradeItemPercent({
                                  type: activity.type,
                                  assessmentType: savedAssessmentTypes[key] ?? activity.type,
                                  score: classified.score,
                                  maxScore: activity.maxScore,
                                }) ?? 0
                              ).toFixed(1)}%`
                            : 'Missing'}
                      </p>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <FinalGradeReleasePanel
        subjectId={subjectId}
        students={students.map((s) => ({ id: s.student_id, name: s.profile?.full_name || 'Student' }))}
        preview={releasePreview}
        hasUnsavedDrafts={hasUnsavedDrafts}
        previewMayBeIncomplete={previewMayBeIncomplete}
      />
    </div>
  );
}

/** Required scores still missing under the Phase 3B release rules (saved data only). */
function RequiredGradesIndicator({ name, preview }: { name: string; preview: ReleasePreview | undefined }) {
  if (!preview) return null;
  if (preview.complete) {
    return <p className="mt-1 text-[10px] font-normal text-emerald-700 dark:text-emerald-400">All required grades entered</p>;
  }
  const n = preview.missing.length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="mt-1 text-[10px] font-normal text-amber-700 underline-offset-2 hover:underline dark:text-amber-400"
          aria-label={`${name}: ${n} required ${n === 1 ? 'grade' : 'grades'} missing`}
        >
          {n} required missing
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 text-xs">
        <p className="mb-1 font-medium">Needed before this grade can be released</p>
        <ul className="space-y-0.5 text-muted-foreground">
          {preview.missing.map((item, i) => (
            <li key={i}>{missingItemLabel(item)}</li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
