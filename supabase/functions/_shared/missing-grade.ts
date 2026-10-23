/** A missing-grade alert needs one recorded score. A new assessment has none. A score of 0 counts. */
export function missingGradeAlertAllowed(input: {
  assessmentType: string;
  scoredSubmissionCount: number;
}): boolean {
  if (!input.assessmentType.trim()) return false;
  return input.scoredSubmissionCount > 0;
}
