import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke } },
}));

import { emailRegistrationRequestRejected } from '@/lib/registration-rejection-email';

describe('emailRegistrationRequestRejected', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('invokes registration_rejected with request id and kind', async () => {
    invoke.mockResolvedValue({ data: { success: true, sent: 1 }, error: null });
    await emailRegistrationRequestRejected('req-1', 'student');
    expect(invoke).toHaveBeenCalledWith('send-notification', {
      body: { event: 'registration_rejected', request_id: 'req-1', kind: 'student' },
    });
  });

  it('treats duplicate as success without error', async () => {
    invoke.mockResolvedValue({ data: { success: true, duplicate: true }, error: null });
    const result = await emailRegistrationRequestRejected('req-2', 'staff');
    expect(result.emailError).toBeNull();
    expect(result.alreadySent).toBe(true);
  });
});
