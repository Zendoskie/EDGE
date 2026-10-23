import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke } },
}));

import {
  emailEnrollmentRequest,
  ENROLLMENT_REQUEST_EMAIL_FAILED,
} from '@/lib/enrollment-request-notification';

describe('emailEnrollmentRequest', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('invokes enrollment_request on send-notification', async () => {
    invoke.mockResolvedValue({ data: { sent: 1, failed: 0 }, error: null });
    await emailEnrollmentRequest('enr-1');
    expect(invoke).toHaveBeenCalledWith('send-notification', {
      body: { event: 'enrollment_request', enrollment_id: 'enr-1' },
    });
  });

  it('requires sent evidence for success', async () => {
    invoke.mockResolvedValue({ data: { success: true, sent: 0, failed: 0 }, error: null });
    const result = await emailEnrollmentRequest('enr-1');
    expect(result).toEqual({ emailError: ENROLLMENT_REQUEST_EMAIL_FAILED, alreadySent: false });
  });

  it('surfaces failed provider responses', async () => {
    invoke.mockResolvedValue({ data: { sent: 0, failed: 1 }, error: null });
    expect(await emailEnrollmentRequest('enr-1')).toEqual({
      emailError: ENROLLMENT_REQUEST_EMAIL_FAILED,
      alreadySent: false,
    });
  });

  it('treats duplicate as already sent', async () => {
    invoke.mockResolvedValue({ data: { duplicate: true, sent: 0 }, error: null });
    expect(await emailEnrollmentRequest('enr-1')).toEqual({ emailError: null, alreadySent: true });
  });

  it('treats skipped instructor resolution as email failure', async () => {
    invoke.mockResolvedValue({ data: { sent: 0, skipped: 'no_email' }, error: null });
    const result = await emailEnrollmentRequest('enr-1');
    expect(result.emailError).toBe(ENROLLMENT_REQUEST_EMAIL_FAILED);
  });

  it('reports invoke errors', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('offline') });
    const result = await emailEnrollmentRequest('enr-1');
    expect(result.emailError).toBe(ENROLLMENT_REQUEST_EMAIL_FAILED);
  });
});
