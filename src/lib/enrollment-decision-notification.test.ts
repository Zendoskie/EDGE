import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke } },
}));

import { emailEnrollmentDecision } from '@/lib/enrollment-decision-notification';

describe('emailEnrollmentDecision', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('invokes enrollment_decision with enrollment id', async () => {
    invoke.mockResolvedValue({ data: { success: true, sent: 1 }, error: null });
    await emailEnrollmentDecision('enr-1');
    expect(invoke).toHaveBeenCalledWith('send-notification', {
      body: { event: 'enrollment_decision', enrollment_id: 'enr-1' },
    });
  });
});
