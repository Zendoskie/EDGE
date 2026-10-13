import type { QueryClient } from '@tanstack/react-query';

export const studentReleaseKey = (studentId: string | null | undefined) =>
  ['final-grade-releases', 'student', studentId] as const;
export const subjectReleaseKey = (subjectId: string | null | undefined) =>
  ['final-grade-releases', 'subject', subjectId] as const;

/** Source changes that can flip a student's release to needs_review and that already reach the student's channel. */
export function isReleaseRelevantRealtime(table: string, eventType: string): boolean {
  return (table === 'attendance' || table === 'predictions') && (eventType === 'INSERT' || eventType === 'UPDATE');
}

/** Server-written inbox titles for a first score (notify_first_activity_grade) and a new activity (notify_missing_activity_grades). */
export const RELEASE_RELEVANT_INBOX_TITLES: readonly string[] = ['Grade posted', 'Missing grade'];

export function isReleaseRelevantInboxTitle(title: string | null | undefined): boolean {
  return !!title && RELEASE_RELEVANT_INBOX_TITLES.includes(title);
}

export function invalidateStudentReleases(queryClient: QueryClient, studentId: string): void {
  void queryClient.invalidateQueries({ queryKey: studentReleaseKey(studentId) });
}
