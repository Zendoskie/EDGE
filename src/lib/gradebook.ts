import { ASSESSMENT_TYPES } from '@/lib/assessment-types';

export type GradebookActivity = {
  id: string;
  title: string;
  type: string;
  maxScore: number;
  subjectId: string | null;
  createdAt?: string | null;
};

export type GradeChange = {
  studentId: string;
  activityId: string;
  score: number;
  assessmentType: string;
};

export function gradeCellKey(studentId: string, activityId: string): string {
  return `${studentId}::${activityId}`;
}

export function assessmentTypeOrder(type: string): number {
  const index = ASSESSMENT_TYPES.findIndex((item) => item.value === type);
  return index === -1 ? ASSESSMENT_TYPES.length : index;
}

export function sortGradebookActivities<T extends { type: string; title: string; createdAt?: string | null }>(
  activities: T[],
): T[] {
  return [...activities].sort((a, b) => {
    const typeDelta = assessmentTypeOrder(a.type) - assessmentTypeOrder(b.type);
    if (typeDelta !== 0) return typeDelta;
    const titleDelta = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    if (titleDelta !== 0) return titleDelta;
    return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
  });
}

export function findDuplicateActivityTitle(
  activities: Array<{ title: string }>,
  title: string,
): boolean {
  const key = title.trim().toLowerCase();
  if (!key) return false;
  return activities.some((activity) => activity.title.trim().toLowerCase() === key);
}

export function classifyGradeInput(
  raw: string,
  maxScore: number,
): { status: 'empty' } | { status: 'valid'; score: number } | { status: 'invalid'; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { status: 'empty' };
  if (!Number.isFinite(maxScore) || maxScore <= 0) {
    return { status: 'invalid', message: 'Assessment max score is invalid.' };
  }
  const score = Number(trimmed);
  if (!Number.isFinite(score)) {
    return { status: 'invalid', message: 'Enter a numeric grade.' };
  }
  if (score < 0) {
    return { status: 'invalid', message: 'Grade cannot be negative.' };
  }
  if (score > maxScore) {
    return { status: 'invalid', message: `Grade cannot exceed ${maxScore}.` };
  }
  return { status: 'valid', score };
}

export function collectGradeChanges(input: {
  subjectId: string;
  enrolledStudentIds: ReadonlySet<string>;
  activities: GradebookActivity[];
  savedScores: Readonly<Record<string, number | null>>;
  drafts: Readonly<Record<string, string>>;
}): { changes: GradeChange[]; invalid: string[]; skippedClears: number } {
  const changes: GradeChange[] = [];
  const invalid: string[] = [];
  let skippedClears = 0;
  const activitiesForSubject = input.activities.filter((activity) => activity.subjectId === input.subjectId);

  for (const activity of activitiesForSubject) {
    if (!activity.type) continue;
    for (const studentId of input.enrolledStudentIds) {
      const key = gradeCellKey(studentId, activity.id);
      if (!(key in input.drafts)) continue;
      const draft = input.drafts[key] ?? '';
      const saved = input.savedScores[key];
      const classified = classifyGradeInput(draft, activity.maxScore);

      if (classified.status === 'empty') {
        if (saved != null) skippedClears += 1;
        continue;
      }
      if (classified.status === 'invalid') {
        invalid.push(`${activity.title}: ${classified.message}`);
        continue;
      }
      if (saved != null && Number(saved) === classified.score) continue;
      changes.push({
        studentId,
        activityId: activity.id,
        score: classified.score,
        assessmentType: activity.type,
      });
    }
  }

  return { changes, invalid, skippedClears };
}

/** Inbox and email copy for a published activity that still has no score. */
export function missingGradeNotificationBody(activityTitle: string, subjectCode: string): string {
  const activity = activityTitle.trim() || 'an activity';
  const subject = subjectCode.trim() || 'your subject';
  return `You have a missing grade for ${activity} in ${subject}.`;
}

/**
 * Active enrollments with no recorded score. A score of 0 is a grade.
 * Callers must only use this after grades for the activity have been published.
 */
export function studentIdsMissingScore(
  enrolledStudentIds: readonly string[],
  scoreByStudentId: ReadonlyMap<string, number | null | undefined>,
): string[] {
  return enrolledStudentIds.filter((studentId) => {
    if (!scoreByStudentId.has(studentId)) return true;
    return scoreByStudentId.get(studentId) == null;
  });
}

export function countMissingGrades(input: {
  enrolledStudentIds: readonly string[];
  activityIds: readonly string[];
  savedScores: Readonly<Record<string, number | null>>;
  drafts: Readonly<Record<string, string>>;
}): number {
  let missing = 0;
  for (const studentId of input.enrolledStudentIds) {
    for (const activityId of input.activityIds) {
      const key = gradeCellKey(studentId, activityId);
      const draft = input.drafts[key];
      if (draft != null && draft.trim() !== '') continue;
      const saved = input.savedScores[key];
      if (saved == null) missing += 1;
    }
  }
  return missing;
}
