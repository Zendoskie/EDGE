import { describe, expect, it } from 'vitest';
import {
  interpretNotificationInvokeResult,
  parseBulkNotificationInvokeResult,
} from '@/lib/notification-invoke-result';

describe('interpretNotificationInvokeResult', () => {
  it('treats sent:1 as success', () => {
    expect(interpretNotificationInvokeResult({ success: true, sent: 1, failed: 0 })).toBe('sent');
  });

  it('treats bulk sent counts as success when nothing failed', () => {
    expect(interpretNotificationInvokeResult({ success: true, sent: 2, failed: 0 })).toBe('sent');
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

  it('treats legacy instructor single-send success as sent', () => {
    expect(interpretNotificationInvokeResult({ success: true, mode: 'single' })).toBe('sent');
  });
});

describe('parseBulkNotificationInvokeResult', () => {
  it('parses bulk delivery counts', () => {
    expect(
      parseBulkNotificationInvokeResult({
        success: true,
        mode: 'bulk',
        sent: 2,
        failed: 1,
        errors: [{ index: 0, message: 'fail' }],
      }),
    ).toEqual({
      valid: true,
      sent: 2,
      failed: 1,
      errors: [{ index: 0, message: 'fail' }],
    });
  });

  it('rejects bare success without counts', () => {
    expect(parseBulkNotificationInvokeResult({ success: true })).toEqual({
      valid: false,
      sent: 0,
      failed: 0,
      errors: [],
    });
  });
});
