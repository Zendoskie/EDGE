import type { MissingItem } from '../../supabase/functions/_shared/final-grade-release.ts';
import { formatAssessmentTypeLabel } from '@/lib/assessment-types';

export type { MissingItem };

export type FinalGradeReleaseRow = {
  status: string | null;
  final_grade: number | string | null;
};

export type FinalGradeStatus =
  | { kind: 'provisional' }
  | { kind: 'final'; grade: number }
  | { kind: 'under_review' };

/**
 * Release state from the authoritative final_grade_releases row. Final only for a released row
 * with a valid grade; any other row is Under review and never exposes a number.
 */
export function finalGradeStatus(row: FinalGradeReleaseRow | null | undefined): FinalGradeStatus {
  if (!row) return { kind: 'provisional' };
  if (row.status === 'released' && row.final_grade != null && row.final_grade !== '') {
    const grade = Number(row.final_grade);
    if (Number.isFinite(grade) && grade >= 0 && grade <= 100) return { kind: 'final', grade };
  }
  return { kind: 'under_review' };
}

const CATEGORY_LABELS: Record<string, string> = {
  activity: 'Activity',
  project: 'Project',
  exam_midterm: 'Midterm Exam',
  exam_final: 'Final Exam',
};

const REVIEW_REASON_LABELS: Record<string, string> = {
  score_added: 'A score was added',
  score_removed: 'A score was removed',
  score_changed: 'A score changed',
  attendance_changed: 'Attendance changed',
  assessment_added: 'An assessment was added',
  assessment_removed: 'An assessment was removed',
  assessment_changed: 'An assessment changed',
  weights_changed: 'Grading weights changed',
};

export function reviewReasonLabel(reason: string | null | undefined): string {
  if (!reason) return 'Grading inputs changed';
  return REVIEW_REASON_LABELS[reason] ?? 'Grading inputs changed';
}

export function missingItemLabel(item: MissingItem): string {
  switch (item.kind) {
    case 'category_empty':
      return `No ${CATEGORY_LABELS[item.category] ?? item.category} assessment yet`;
    case 'assessment_unscored':
      if (item.reason === 'invalid_max_score') return `${item.title}: invalid max score`;
      return `${item.title} (${formatAssessmentTypeLabel(item.type)}): no score`;
    case 'attendance_missing':
      return 'No attendance recorded';
    case 'attendance_all_excused':
      return 'All attendance is excused';
  }
}
