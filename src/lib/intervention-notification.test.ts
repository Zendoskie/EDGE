import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke } },
}));

import {
  emailCounselorFollowup,
  emailEngagementIntervention,
  emailLoggedIntervention,
  INTERVENTION_SAVED_EMAIL_FAILED,
} from '@/lib/intervention-notification';

describe('intervention notification clients', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  describe('emailEngagementIntervention', () => {
    it('invokes send-notification with engagement_intervention', async () => {
      invoke.mockResolvedValue({ data: { sent: 1, failed: 0 }, error: null });
      await emailEngagementIntervention('int-1');
      expect(invoke).toHaveBeenCalledWith('send-notification', {
        body: { event: 'engagement_intervention', intervention_id: 'int-1' },
      });
    });

    it('does not treat sent:0 as success', async () => {
      invoke.mockResolvedValue({ data: { sent: 0, failed: 0 }, error: null });
      const result = await emailEngagementIntervention('int-1');
      expect(result.emailError).toBe(INTERVENTION_SAVED_EMAIL_FAILED);
    });
  });

  describe('emailLoggedIntervention', () => {
    it('invokes logged_intervention', async () => {
      invoke.mockResolvedValue({ data: { sent: 1, failed: 0 }, error: null });
      await emailLoggedIntervention('int-2');
      expect(invoke).toHaveBeenLastCalledWith('send-notification', {
        body: { event: 'logged_intervention', intervention_id: 'int-2' },
      });
    });
  });

  describe('emailCounselorFollowup', () => {
    it('invokes send-referral-notification', async () => {
      invoke.mockResolvedValue({ data: { sent: 1, failed: 0 }, error: null });
      await emailCounselorFollowup('int-3');
      expect(invoke).toHaveBeenCalledWith('send-referral-notification', {
        body: { event: 'counselor_followup', intervention_id: 'int-3' },
      });
    });

    it('treats duplicate as already sent', async () => {
      invoke.mockResolvedValue({ data: { duplicate: true, sent: 0 }, error: null });
      const result = await emailCounselorFollowup('int-3');
      expect(result).toEqual({ emailError: null, alreadySent: true });
    });

    it('treats skipped as failure without claiming delivery', async () => {
      invoke.mockResolvedValue({ data: { sent: 0, skipped: 'no_email' }, error: null });
      const result = await emailCounselorFollowup('int-3');
      expect(result.emailError).toBe(INTERVENTION_SAVED_EMAIL_FAILED);
    });
  });
});
