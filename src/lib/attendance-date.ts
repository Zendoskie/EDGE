const manilaParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar date in Asia/Manila as YYYY-MM-DD; the date attendance sessions are recorded against. */
export function manilaToday(now: Date = new Date()): string {
  const parts = Object.fromEntries(manilaParts.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Clamp a picked YYYY-MM-DD date so attendance can never target a future Manila date. */
export function clampAttendanceDate(value: string, today: string = manilaToday()): string {
  return value && value > today ? today : value;
}
