import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  collectGradeChanges,
  gradeCellKey,
  gradesPostedItemsFromSavedScores,
} from '@/lib/gradebook';
import { canReadInboxRow } from '@/lib/notification-delivery';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const subjectId = 'subject-1';
const studentId = 'student-a';

describe('student grade-posted inbox (database trigger)', () => {
  const migration = read('supabase/migrations/20261022153000_student_grade_posted_inbox_dedupe.sql');
  const phase1 = read('supabase/migrations/20261005043052_phase1_enrollment_notifications.sql');
  const parentInbox = read('supabase/migrations/20261021103000_round2_enrollment_and_parent_inbox.sql');
  const missingGrade = read('supabase/migrations/20261018130000_missing_grade_requires_recorded_score.sql');

  it('writes one inbox row per first recorded score via notify_first_activity_grade on submissions', () => {
    expect(migration).toContain('notify_first_activity_grade');
    expect(migration).toContain('NEW.student_id');
    expect(migration).toContain('NEW.score IS NULL');
    expect(migration).toContain('OLD.score IS NOT NULL');
    expect(migration).toContain("'Grade posted'");
    expect(migration).toContain("'grade-posted:'");
    expect(migration).toContain('ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING');
    expect(migration).toContain('trg_notify_first_activity_grade');
    expect(phase1).toContain('notify_first_activity_grade');
  });

  it('partial save A1 and ME produces two grade changes and does not include missing P1', () => {
    const a1 = { id: 'a1', title: 'Activity A1', type: 'activity', maxScore: 20, subjectId };
    const p1 = { id: 'p1', title: 'Project P1', type: 'project', maxScore: 100, subjectId };
    const mid = { id: 'mid', title: 'Midterm Exam', type: 'midterm_exam', maxScore: 50, subjectId };
    const result = collectGradeChanges({
      subjectId,
      enrolledStudentIds: new Set([studentId]),
      activities: [a1, p1, mid],
      savedScores: {},
      drafts: {
        [gradeCellKey(studentId, 'a1')]: '16',
        [gradeCellKey(studentId, 'p1')]: '',
        [gradeCellKey(studentId, 'mid')]: '45',
      },
    });
    expect(result.changes).toHaveLength(2);
    expect(result.changes.map((c) => c.activityId).sort()).toEqual(['a1', 'mid']);
    expect(result.changes.some((c) => c.activityId === 'p1')).toBe(false);
  });

  it('dedupe_key prevents duplicate inbox rows when the same first score is written again', () => {
    expect(migration).toContain("v_dedupe_key := 'grade-posted:' || NEW.activity_id::text || ':' || NEW.student_id::text");
    expect(migration).toContain('DO NOTHING');
    const unchanged = collectGradeChanges({
      subjectId,
      enrolledStudentIds: new Set([studentId]),
      activities: [{ id: 'a1', title: 'A1', type: 'activity', maxScore: 20, subjectId }],
      savedScores: { [gradeCellKey(studentId, 'a1')]: 16 },
      drafts: { [gradeCellKey(studentId, 'a1')]: '16' },
    });
    expect(unchanged.changes).toEqual([]);
  });

  it('keeps grades_posted email payload aligned with recorded scores only', () => {
    const items = gradesPostedItemsFromSavedScores({
      subjectId,
      enrolledStudentIds: new Set([studentId]),
      activities: [
        { id: 'a1', title: 'A1', type: 'activity', maxScore: 20, subjectId },
        { id: 'p1', title: 'P1', type: 'project', maxScore: 100, subjectId },
        { id: 'mid', title: 'ME', type: 'midterm_exam', maxScore: 50, subjectId },
      ],
      savedScores: {
        [gradeCellKey(studentId, 'a1')]: 16,
        [gradeCellKey(studentId, 'p1')]: null,
        [gradeCellKey(studentId, 'mid')]: 45,
      },
    });
    expect(items).toEqual([
      { activity_id: 'a1', student_id: studentId },
      { activity_id: 'mid', student_id: studentId },
    ]);
  });

  it('leaves parent grade inbox and missing-grade flows separate', () => {
    expect(parentInbox).toContain('notify_linked_parents_inbox');
    expect(parentInbox).toContain('Grade update for your student');
    expect(parentInbox).toContain('NEW.score IS NULL');
    expect(missingGrade).toContain('notify_missing_activity_grades');
    expect(missingGrade).toContain("'Missing grade'");
    expect(missingGrade).toContain('submission.score IS NOT NULL');
  });

  it('restricts inbox visibility to the notified student', () => {
    expect(canReadInboxRow(studentId, studentId)).toBe(true);
    expect(canReadInboxRow(studentId, 'instructor-1')).toBe(false);
    expect(canReadInboxRow(studentId, 'other-student')).toBe(false);
  });

  it('does not grant students insert access to inbox rows (notifications follow submission RLS)', () => {
    const submissionsRls = read('supabase/migrations/20260303124018_1e0e503d-bf1b-4dcf-b418-4b3da9279f58.sql');
    expect(submissionsRls).toContain('Instructors can manage submissions');
    expect(submissionsRls).toContain('Students can view own submissions');
    expect(migration).not.toContain('GRANT INSERT ON public.user_inbox_notifications');
  });

  it('keeps grade email on the edge path without a second client inbox writer', () => {
    const table = read('src/components/GradebookTable.tsx');
    const save = table.slice(table.indexOf('const saveGrades = useMutation'), table.indexOf('onSuccess: async (result)'));
    expect(save).toContain('emailGradesPosted');
    expect(save).not.toContain("from('user_inbox_notifications')");
    const notifyFn = read('supabase/functions/send-notification/index.ts');
    const gradesFn = notifyFn.slice(
      notifyFn.indexOf('async function sendGradesPostedEmail'),
      notifyFn.indexOf('async function sendRiskFeedbackEmail'),
    );
    expect(gradesFn).not.toContain('user_inbox_notifications');
  });
});
