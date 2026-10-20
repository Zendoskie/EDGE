import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke } },
}));

import {
  EARLY_WARNING_SAVED_EMAIL_FAILED,
  sendEarlyWarningEmail,
} from '@/lib/early-warning-notification';

const baseInput = {
  studentEmail: 'student@example.com',
  studentId: 'stu-1',
  subjectId: 'sub-1',
  latestRisk: 'at_risk',
  subjectCode: 'PL101',
  subjectName: 'Programming Logic',
  message: 'Early warning alert',
};

describe('sendEarlyWarningEmail', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('invokes instructor single-send payload', async () => {
    invoke.mockResolvedValue({ data: { success: true, mode: 'single' }, error: null });
    const result = await sendEarlyWarningEmail(baseInput);
    expect(result.emailError).toBeNull();
    expect(invoke).toHaveBeenCalledWith('send-notification', {
      body: expect.objectContaining({
        to: 'student@example.com',
        body: 'Early warning alert',
        risk_level: 'at_risk',
      }),
    });
  });

  it('does not treat empty success bodies as delivered', async () => {
    invoke.mockResolvedValue({ data: { success: true, sent: 0, failed: 0 }, error: null });
    const result = await sendEarlyWarningEmail(baseInput);
    expect(result.emailError).toBe(EARLY_WARNING_SAVED_EMAIL_FAILED);
  });

  it('returns transport errors without claiming delivery', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'network down' } });
    const result = await sendEarlyWarningEmail(baseInput);
    expect(result.emailError).toContain(EARLY_WARNING_SAVED_EMAIL_FAILED);
    expect(result.emailError).toContain('network down');
  });

  it('treats duplicate as delivered', async () => {
    invoke.mockResolvedValue({ data: { duplicate: true, sent: 0, failed: 0 }, error: null });
    const result = await sendEarlyWarningEmail(baseInput);
    expect(result.emailError).toBeNull();
  });
});
