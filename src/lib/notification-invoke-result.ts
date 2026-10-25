export type NotificationInvokeOutcome = 'sent' | 'duplicate' | 'failed';

export type BulkNotificationInvokeParse = {
  valid: boolean;
  sent: number;
  failed: number;
  errors: Array<{ index: number; message: string }>;
};

/** Bulk instructor send-notification (`recipients` array); not interchangeable with single/event parsing. */
export function parseBulkNotificationInvokeResult(data: unknown): BulkNotificationInvokeParse {
  const empty = { valid: false, sent: 0, failed: 0, errors: [] as BulkNotificationInvokeParse['errors'] };
  if (!data || typeof data !== 'object') return empty;
  const body = data as Record<string, unknown>;
  if (body.error) return empty;
  const sent = typeof body.sent === 'number' ? body.sent : null;
  const failed = typeof body.failed === 'number' ? body.failed : null;
  if (sent === null || failed === null) return empty;
  const errors = Array.isArray(body.errors)
    ? body.errors
        .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
        .map((entry) => ({
          index: typeof entry.index === 'number' ? entry.index : -1,
          message: typeof entry.message === 'string' ? entry.message : 'Unknown error',
        }))
    : [];
  return { valid: true, sent, failed, errors };
}

/** Interpret send-notification JSON; HTTP 200 alone is not success. */
export function interpretNotificationInvokeResult(data: unknown): NotificationInvokeOutcome {
  if (!data || typeof data !== 'object') return 'failed';
  const body = data as Record<string, unknown>;
  if (body.error) return 'failed';
  if (body.duplicate === true) return 'duplicate';
  if (body.skipped === true) return 'sent';
  if (body.mode === 'single' && body.success === true) return 'sent';
  const failed = typeof body.failed === 'number' ? body.failed : 0;
  if (failed > 0) return 'failed';
  const sent = typeof body.sent === 'number' ? body.sent : 0;
  if (sent >= 1) return 'sent';
  return 'failed';
}
