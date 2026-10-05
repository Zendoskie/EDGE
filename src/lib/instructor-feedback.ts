export function countPendingEngagementFeedback(
  rows: ReadonlyArray<{ status?: string | null }>,
): number {
  return rows.filter((row) => (row.status ?? 'submitted') === 'submitted').length;
}
