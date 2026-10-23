import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke } },
}));

import {
  REFERRAL_SAVED_EMAIL_FAILED,
  REFERRAL_SAVED_EMAIL_PARTIAL,
  sendReferralNotification,
} from '@/lib/referral-notifications';

describe('sendReferralNotification', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('invokes send-referral-notification with referral payload', async () => {
    invoke.mockResolvedValue({ data: { success: true, sent: 1, failed: 0 }, error: null });
    const result = await sendReferralNotification({ event: 'referral_created', referralId: 'ref-1' });
    expect(invoke).toHaveBeenCalledWith('send-referral-notification', {
      body: { event: 'referral_created', referral_id: 'ref-1', counselor_remarks: null },
    });
    expect(result).toEqual({ emailError: null, alreadySent: false });
  });

  it('returns email failure on transport errors without claiming delivery', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'network down' } });
    const result = await sendReferralNotification({
      event: 'referral_decided',
      referralId: 'ref-2',
      counselorRemarks: 'ok',
    });
    expect(result).toEqual({ emailError: REFERRAL_SAVED_EMAIL_FAILED, alreadySent: false });
  });

  it('does not treat HTTP 200 with zero sends as delivered', async () => {
    invoke.mockResolvedValue({ data: { success: true, sent: 0, failed: 0 }, error: null });
    const result = await sendReferralNotification({ event: 'referral_created', referralId: 'ref-3' });
    expect(result).toEqual({ emailError: REFERRAL_SAVED_EMAIL_FAILED, alreadySent: false });
  });

  it('reports partial batch delivery without claiming full success', async () => {
    invoke.mockResolvedValue({ data: { success: true, sent: 1, failed: 1 }, error: null });
    const result = await sendReferralNotification({ event: 'referral_decided', referralId: 'ref-4' });
    expect(result).toEqual({ emailError: REFERRAL_SAVED_EMAIL_PARTIAL, alreadySent: false });
  });

  it('treats duplicate as idempotent success without user-facing email error', async () => {
    invoke.mockResolvedValue({ data: { duplicate: true, sent: 0, failed: 0 }, error: null });
    const result = await sendReferralNotification({ event: 'referral_created', referralId: 'ref-5' });
    expect(result).toEqual({ emailError: null, alreadySent: true });
  });

  it('flags malformed success bodies as email failure', async () => {
    invoke.mockResolvedValue({ data: { success: true }, error: null });
    const result = await sendReferralNotification({ event: 'referral_created', referralId: 'ref-6' });
    expect(result).toEqual({ emailError: REFERRAL_SAVED_EMAIL_FAILED, alreadySent: false });
  });
});
