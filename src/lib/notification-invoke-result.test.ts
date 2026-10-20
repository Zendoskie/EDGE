import { describe, expect, it } from 'vitest';
import { interpretNotificationInvokeResult } from '@/lib/notification-invoke-result';

describe('interpretNotificationInvokeResult', () => {
  it('treats sent:1 as success', () => {
    expect(interpretNotificationInvokeResult({ success: true, sent: 1, failed: 0 })).toBe('sent');
  });

  it('treats duplicate as idempotent success', () => {
    expect(
      interpretNotificationInvokeResult({ success: true, sent: 0, failed: 0, duplicate: true }),
    ).toBe('duplicate');
  });

  it('does not treat bare HTTP-style success as delivered', () => {
    expect(interpretNotificationInvokeResult({ success: true, sent: 0, failed: 0 })).toBe('failed');
    expect(interpretNotificationInvokeResult(null)).toBe('failed');
    expect(interpretNotificationInvokeResult({ error: 'Reply not found' })).toBe('failed');
  });

  it('treats provider and skip failures honestly', () => {
    expect(interpretNotificationInvokeResult({ sent: 0, failed: 1 })).toBe('failed');
    expect(interpretNotificationInvokeResult({ sent: 0, skipped: 'no_email' })).toBe('failed');
  });
});
