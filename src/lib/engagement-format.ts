export function formatTimeSpent(totalSeconds: number | null | undefined): string {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (seconds < 60) return `${seconds} Second${seconds === 1 ? '' : 's'}`;

  const totalMinutes = Math.floor(seconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} Minute${totalMinutes === 1 ? '' : 's'}`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (minutes === 0) {
    return `${hours} Hour${hours === 1 ? '' : 's'}`;
  }

  return `${hours} Hour${hours === 1 ? '' : 's'} ${minutes} Minute${minutes === 1 ? '' : 's'}`;
}

export function formatLastLogin(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatFeedbackStatus(status: string | null | undefined): string {
  if (!status) return 'Submitted';
  if (status === 'submitted') return 'Submitted';
  if (status === 'reviewed') return 'Reviewed';
  if (status === 'resolved') return 'Resolved';
  return status.charAt(0).toUpperCase() + status.slice(1);
}
