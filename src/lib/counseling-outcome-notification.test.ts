import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, rpc } = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke }, rpc },
}));

import {
  OUTCOME_SAVED_EMAIL_FAILED,
  recordCounselingOutcome,
  retryCounselingOutcomeEmail,
} from '@/lib/counseling-outcome-notification';

describe('counseling outcome notification client', () => {
  beforeEach(() => {
    invoke.mockReset();
    rpc.mockReset();
  });

  it('routes counselor outcomes through send-referral-notification', async () => {
    rpc.mockResolvedValue({ data: 'int-1', error: null });
    invoke.mockResolvedValue({ data: { sent: 1, failed: 0 }, error: null });
    const result = await recordCounselingOutcome({
      interventionId: 'int-1',
      outcomeRating: 'improved',
      actionType: 'guidance_counseling',
      actorRole: 'guidance_counselor',
    });
    expect(result).toEqual({ id: 'int-1', emailError: null, alreadySent: false });
    expect(invoke).toHaveBeenCalledWith('send-referral-notification', {
      body: { event: 'counseling_outcome', intervention_id: 'int-1' },
    });
  });

  it('routes instructor outcomes through send-notification engagement_outcome', async () => {
    invoke.mockResolvedValue({ data: { sent: 1, failed: 0 }, error: null });
    await retryCounselingOutcomeEmail('int-2', 'send_reminder', 'instructor');
    expect(invoke).toHaveBeenCalledWith('send-notification', {
      body: { event: 'engagement_outcome', intervention_id: 'int-2' },
    });
  });

  it('does not treat bare HTTP success as delivered', async () => {
    invoke.mockResolvedValue({ data: { success: true, sent: 0, failed: 0 }, error: null });
    const result = await retryCounselingOutcomeEmail('int-3', 'send_reminder', 'instructor');
    expect(result).toEqual({ emailError: OUTCOME_SAVED_EMAIL_FAILED, alreadySent: false });
  });

  it('keeps outcome saved when email invoke fails', async () => {
    rpc.mockResolvedValue({ data: 'int-4', error: null });
    invoke.mockResolvedValue({ data: null, error: { message: 'provider down' } });
    const result = await recordCounselingOutcome({
      interventionId: 'int-4',
      outcomeRating: 'improved',
      actionType: 'guidance_counseling',
      actorRole: 'guidance_counselor',
    });
    expect(result.id).toBe('int-4');
    expect(result.emailError).toBe(OUTCOME_SAVED_EMAIL_FAILED);
  });

  it('treats duplicate as already sent without error', async () => {
    invoke.mockResolvedValue({ data: { duplicate: true, sent: 0 }, error: null });
    const result = await retryCounselingOutcomeEmail('int-5', 'guidance_counseling', 'guidance_counselor');
    expect(result).toEqual({ emailError: null, alreadySent: true });
  });

  it('treats skipped as email failure', async () => {
    invoke.mockResolvedValue({ data: { sent: 0, skipped: 'no_email' }, error: null });
    const result = await retryCounselingOutcomeEmail('int-6', 'send_reminder', 'instructor');
    expect(result.emailError).toBe(OUTCOME_SAVED_EMAIL_FAILED);
  });
});
