import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke } },
}));

import { sendReferralNotification } from '@/lib/referral-notifications';

describe('sendReferralNotification', () => {
  beforeEach(() => {
    invoke.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('invokes send-referral-notification with referral payload', async () => {
    invoke.mockResolvedValue({ data: { success: true, sent: 1, failed: 0 }, error: null });
    await sendReferralNotification({ event: 'referral_created', referralId: 'ref-1' });
    expect(invoke).toHaveBeenCalledWith('send-referral-notification', {
      body: { event: 'referral_created', referral_id: 'ref-1', counselor_remarks: null },
    });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('warns on transport errors', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'network down' } });
    await sendReferralNotification({ event: 'referral_decided', referralId: 'ref-2', counselorRemarks: 'ok' });
    expect(console.warn).toHaveBeenCalledWith('send-referral-notification failed:', 'network down');
  });

  it('does not treat HTTP 200 with zero sends as delivered', async () => {
    invoke.mockResolvedValue({ data: { success: true, sent: 0, failed: 0 }, error: null });
    await sendReferralNotification({ event: 'referral_created', referralId: 'ref-3' });
    expect(console.warn).toHaveBeenCalledWith(
      'send-referral-notification did not deliver email:',
      { success: true, sent: 0, failed: 0 },
    );
  });

  it('warns when batch reports failures even if some emails sent', async () => {
    invoke.mockResolvedValue({ data: { success: true, sent: 1, failed: 1 }, error: null });
    await sendReferralNotification({ event: 'referral_decided', referralId: 'ref-4' });
    expect(console.warn).toHaveBeenCalledWith(
      'send-referral-notification did not deliver email:',
      { success: true, sent: 1, failed: 1 },
    );
  });

  it('stays silent on duplicate delivery', async () => {
    invoke.mockResolvedValue({ data: { duplicate: true, sent: 0, failed: 0 }, error: null });
    await sendReferralNotification({ event: 'referral_created', referralId: 'ref-5' });
    expect(console.warn).not.toHaveBeenCalled();
  });
});
