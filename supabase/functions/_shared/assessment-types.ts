/**
 * Edge copy of the assessment-type list in src/lib/assessment-types.ts and the gradebook
 * order in src/lib/gradebook.ts. Pure: no Deno or network imports.
 * Locked to the client lists by the parity test in src/lib/notification-channels.test.ts.
 */

/** Every stored type, so legacy rows keep their labels and gradebook order. */
export const ASSESSMENT_TYPES = [
  { value: "activity", label: "Activity" },
  { value: "assignment", label: "Assignment" },
  { value: "quiz", label: "Quiz" },
  { value: "laboratory_exam", label: "Laboratory Exam" },
  { value: "midterm_exam", label: "Midterm Exam" },
  { value: "final_exam", label: "Final Exam" },
  { value: "project", label: "Project" },
] as const;

const LABEL_BY_VALUE: Record<string, string> = Object.fromEntries(
  ASSESSMENT_TYPES.map(({ value, label }) => [value, label]),
);

/** Display label: known types use their stored label, a legacy `exam` stays `Exam`. */
export function formatAssessmentTypeLabel(value: string | null | undefined): string {
  if (!value) return "—";
  if (value === "exam") return "Exam";
  const known = LABEL_BY_VALUE[value];
  if (known) return known;
  // Unknown stored value: keep it readable in an email rather than showing raw snake_case.
  return value.replace(/_/g, " ").replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/** Gradebook order: known types in list order, any other type last. */
export function assessmentTypeOrder(value: string | null | undefined): number {
  const index = ASSESSMENT_TYPES.findIndex((item) => item.value === value);
  return index === -1 ? ASSESSMENT_TYPES.length : index;
}
