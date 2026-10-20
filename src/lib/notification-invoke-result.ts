export type NotificationInvokeOutcome = 'sent' | 'duplicate' | 'failed';

/** Interpret send-notification JSON; HTTP 200 alone is not success. */
export function interpretNotificationInvokeResult(data: unknown): NotificationInvokeOutcome {
  if (!data || typeof data !== 'object') return 'failed';
  const body = data as Record<string, unknown>;
  if (body.error) return 'failed';
  if (body.duplicate === true) return 'duplicate';
  if (body.skipped) return 'failed';
  if (body.mode === 'single' && body.success === true) return 'sent';
  const failed = typeof body.failed === 'number' ? body.failed : 0;
  if (failed > 0) return 'failed';
  const sent = typeof body.sent === 'number' ? body.sent : 0;
  if (sent >= 1) return 'sent';
  return 'failed';
}
