/** Activity is eligible for missing-grade alerts once any submission has a recorded score (0 counts). */
export function activityIdsWithAtLeastOneRecordedScore(
  submissions: ReadonlyArray<{ activity_id: string; score: number | null }>,
): string[] {
  const eligible = new Set<string>();
  for (const row of submissions) {
    if (!row.activity_id) continue;
    if (row.score !== null && row.score !== undefined) eligible.add(row.activity_id);
  }
  return [...eligible];
}
