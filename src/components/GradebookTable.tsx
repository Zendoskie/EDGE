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
  sortGradebookActivities,
  type GradebookActivity,
} from '@/lib/gradebook';
import { recalculateSubjectRisk } from '@/lib/recalculate-risk';
import type { EnrollmentListRow } from '@/types/dashboard';

type SubmissionRow = {
  id: string;
  activity_id: string | null;
  student_id: string | null;
  score: number | null;
};

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
}: {
  subjectId: string;
  userId?: string;
  activities: ActivityRow[];
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
        .select('id, activity_id, student_id, score')
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

  const enrolledIds = useMemo(() => students.map((student) => student.student_id), [students]);
  const missingCount = countMissingGrades({
    enrolledStudentIds: enrolledIds,
    activityIds,
    savedScores,
    drafts,
  });

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

      const firstGrades = changes.filter(
        (change) => savedScores[gradeCellKey(change.studentId, change.activityId)] == null,
      );
      if (firstGrades.length > 0) {
        try {
          const { data: subject } = await supabase
            .from('subjects')
            .select('code, name')
            .eq('id', subjectId)
            .maybeSingle();
          const linesByStudent = new Map<string, string[]>();
          for (const change of firstGrades) {
            const activity = columns.find((column) => column.id === change.activityId);
            const line = `${activity?.title ?? 'Activity'}: ${change.score}`;
            const existing = linesByStudent.get(change.studentId) ?? [];
            existing.push(line);
            linesByStudent.set(change.studentId, existing);
          }
          for (const [studentId, lines] of linesByStudent) {
            const email = students.find((student) => student.student_id === studentId)?.profile?.email;
            if (!email) continue;
            const { error: emailError } = await supabase.functions.invoke('send-notification', {
              body: {
                to: email,
                student_id: studentId,
                subject_id: subjectId,
                subject_code: subject?.code ?? 'EDGE',
                subject_name: subject?.name ?? 'Course',
                body: `A grade is now available for ${subject?.code ?? 'your subject'}.\n${lines.join('\n')}`,
              },
            });
            if (emailError) {
              toast.message('Grade saved. The email notification could not be sent.');
            }
          }
        } catch {
          toast.message('Grade saved. The email notification could not be sent.');
        }
      }

      return { saved: rows.length, skippedClears };
    },
    onSuccess: async (result) => {
      setDrafts({});
      await queryClient.invalidateQueries({ queryKey: ['gradebook-submissions', subjectId] });
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
            {missingCount === 0 ? 'No missing grades' : `${missingCount} missing`}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Enter a score from 0 through each assessment&apos;s max. Empty cells stay unsaved.
          </span>
        </div>
        <Button size="sm" onClick={() => saveGrades.mutate()} disabled={saveGrades.isPending}>
          <Save className="mr-2 h-4 w-4" />
          {saveGrades.isPending ? 'Saving...' : 'Save grades'}
        </Button>
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
                            ? `${((classified.score / activity.maxScore) * 100).toFixed(1)}%`
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
    </div>
  );
}
