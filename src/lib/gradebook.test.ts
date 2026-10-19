import { describe, expect, it } from 'vitest';
import {
  classifyGradeInput,
  collectGradeChanges,
  countMissingGrades,
  missingGradeNotificationBody,
  studentIdsMissingScore,
  findDuplicateActivityTitle,
  gradeCellKey,
  gradesPostedItemsFromSavedScores,
  sortGradebookActivities,
} from './gradebook';

const subjectId = 'subject-1';
const activities = [
  { id: 'quiz', title: 'Quiz 1', type: 'quiz', maxScore: 50, subjectId },
  { id: 'act', title: 'Activity 1', type: 'activity', maxScore: 100, subjectId },
  { id: 'other', title: 'Other course', type: 'quiz', maxScore: 10, subjectId: 'subject-2' },
];

describe('gradebook', () => {
  it('orders columns by assessment type then title', () => {
    const sorted = sortGradebookActivities([
      { title: 'Final Exam', type: 'final_exam' },
      { title: 'Activity 2', type: 'activity' },
      { title: 'Activity 1', type: 'activity' },
      { title: 'Project', type: 'project' },
    ]);
    expect(sorted.map((item) => item.title)).toEqual([
      'Activity 1',
      'Activity 2',
      'Final Exam',
      'Project',
    ]);
  });

  it('rejects a duplicate assessment title in the same subject', () => {
    expect(findDuplicateActivityTitle([{ title: 'Quiz 1' }], ' quiz 1 ')).toBe(true);
    expect(findDuplicateActivityTitle([{ title: 'Quiz 1' }], 'Quiz 2')).toBe(false);
  });

  it('validates grade bounds', () => {
    expect(classifyGradeInput('', 100).status).toBe('empty');
    expect(classifyGradeInput('40', 50)).toEqual({ status: 'valid', score: 40 });
    expect(classifyGradeInput('abc', 50).status).toBe('invalid');
    expect(classifyGradeInput('-1', 50).status).toBe('invalid');
    expect(classifyGradeInput('51', 50).status).toBe('invalid');
  });

  it('saves only changed grades for enrolled students in this subject', () => {
    const quizKey = gradeCellKey('student-a', 'quiz');
    const result = collectGradeChanges({
      subjectId,
      enrolledStudentIds: new Set(['student-a']),
      activities,
      savedScores: { [quizKey]: 10 },
      drafts: {
        [quizKey]: '20',
        [gradeCellKey('student-a', 'act')]: '',
        [gradeCellKey('outsider', 'quiz')]: '5',
        [gradeCellKey('student-a', 'other')]: '5',
      },
    });
    expect(result.invalid).toEqual([]);
    expect(result.changes).toEqual([
      { studentId: 'student-a', activityId: 'quiz', score: 20, assessmentType: 'quiz' },
    ]);
  });

  it('saves A1 and Midterm without treating blank P1 as zero', () => {
    const a1 = { id: 'a1', title: 'Activity A1', type: 'activity', maxScore: 20, subjectId };
    const p1 = { id: 'p1', title: 'Project P1', type: 'project', maxScore: 100, subjectId };
    const mid = { id: 'mid', title: 'Midterm Exam', type: 'midterm_exam', maxScore: 50, subjectId };
    const result = collectGradeChanges({
      subjectId,
      enrolledStudentIds: new Set(['student-a']),
      activities: [a1, p1, mid],
      savedScores: {},
      drafts: {
        [gradeCellKey('student-a', 'a1')]: '16',
        [gradeCellKey('student-a', 'p1')]: '',
        [gradeCellKey('student-a', 'mid')]: '45',
      },
    });
    expect(result.invalid).toEqual([]);
    expect(result.changes).toEqual([
      { studentId: 'student-a', activityId: 'a1', score: 16, assessmentType: 'activity' },
      { studentId: 'student-a', activityId: 'mid', score: 45, assessmentType: 'midterm_exam' },
    ]);
    expect(result.changes.some((change) => change.activityId === 'p1')).toBe(false);
  });

  it('builds a grades_posted retry payload from saved scores without inventing P1 as zero', () => {
    const a1 = { id: 'a1', title: 'Activity A1', type: 'activity', maxScore: 20, subjectId };
    const p1 = { id: 'p1', title: 'Project P1', type: 'project', maxScore: 100, subjectId };
    const mid = { id: 'mid', title: 'Midterm Exam', type: 'midterm_exam', maxScore: 50, subjectId };
    const items = gradesPostedItemsFromSavedScores({
      subjectId,
      enrolledStudentIds: new Set(['student-a']),
      activities: [a1, p1, mid],
      savedScores: {
        [gradeCellKey('student-a', 'a1')]: 16,
        [gradeCellKey('student-a', 'p1')]: null,
        [gradeCellKey('student-a', 'mid')]: 45,
      },
    });
    expect(items).toEqual([
      { activity_id: 'a1', student_id: 'student-a' },
      { activity_id: 'mid', student_id: 'student-a' },
    ]);
    expect(items.some((item) => item.activity_id === 'p1')).toBe(false);
  });

  it('does not treat an unchanged grade or a blank cell as a new save', () => {
    const quizKey = gradeCellKey('student-a', 'quiz');
    const result = collectGradeChanges({
      subjectId,
      enrolledStudentIds: new Set(['student-a']),
      activities,
      savedScores: { [quizKey]: 20 },
      drafts: {
        [quizKey]: '20',
        [gradeCellKey('student-a', 'act')]: '',
      },
    });
    expect(result.changes).toEqual([]);
    expect(result.skippedClears).toBe(0);
  });

  it('blocks invalid grades and does not clear a saved grade with a blank', () => {
    const quizKey = gradeCellKey('student-a', 'quiz');
    const result = collectGradeChanges({
      subjectId,
      enrolledStudentIds: new Set(['student-a']),
      activities,
      savedScores: { [quizKey]: 12 },
      drafts: {
        [quizKey]: '',
        [gradeCellKey('student-a', 'act')]: '150',
      },
    });
    expect(result.changes).toEqual([]);
    expect(result.skippedClears).toBe(1);
    expect(result.invalid[0]).toMatch(/cannot exceed 100/);
  });

  it('counts cells with no saved or drafted grade as missing', () => {
    const missing = countMissingGrades({
      enrolledStudentIds: ['student-a', 'student-b'],
      activityIds: ['quiz', 'act'],
      savedScores: { [gradeCellKey('student-a', 'quiz')]: 10 },
      drafts: { [gradeCellKey('student-b', 'act')]: '8' },
    });
    expect(missing).toBe(2);
  });

  it('describes a missing published grade by activity and subject', () => {
    expect(missingGradeNotificationBody('Activity 1', 'PL101')).toBe(
      'You have a missing grade for Activity 1 in PL101.',
    );
  });

  it('treats a blank score as missing and a zero as graded', () => {
    const scores = new Map<string, number | null>([
      ['graded', 80],
      ['zero', 0],
      ['blank', null],
    ]);
    expect(studentIdsMissingScore(['graded', 'zero', 'blank', 'absent'], scores)).toEqual([
      'blank',
      'absent',
    ]);
  });
});
