export const ASSESSMENT_TYPES = [
  { value: 'activity', label: 'Activity' },
  { value: 'quiz', label: 'Quiz' },
  { value: 'laboratory_exam', label: 'Laboratory Exam' },
  { value: 'midterm_exam', label: 'Midterm Exam' },
  { value: 'final_exam', label: 'Final Exam' },
  { value: 'project', label: 'Project' },
] as const;

export type AssessmentType = (typeof ASSESSMENT_TYPES)[number]['value'];

const LABEL_BY_VALUE = Object.fromEntries(
  ASSESSMENT_TYPES.map(({ value, label }) => [value, label]),
) as Record<AssessmentType, string>;

export function formatAssessmentTypeLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return LABEL_BY_VALUE[value as AssessmentType] ?? value.replace(/_/g, ' ');
}

export function isValidAssessmentType(value: string | null | undefined): value is AssessmentType {
  return !!value && value in LABEL_BY_VALUE;
}
