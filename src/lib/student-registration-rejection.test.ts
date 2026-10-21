import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, invoke } = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc,
    functions: { invoke },
  },
}));

import { rejectStudentRegistrationRequest } from '@/lib/student-registration-rejection';

describe('rejectStudentRegistrationRequest', () => {
  beforeEach(() => {
    rpc.mockReset();
    invoke.mockReset();
  });

  it('passes rejection reason to the RPC then invokes registration_rejected', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    invoke.mockResolvedValue({ data: { success: true, sent: 1 }, error: null });

    const result = await rejectStudentRegistrationRequest({
      requestId: 'req-1',
      rejectionReason: 'ID mismatch',
    });

    expect(result).toEqual({ ok: true, emailError: null, alreadySent: false });
    expect(rpc).toHaveBeenCalledWith('admin_review_student_request', {
      p_request_id: 'req-1',
      p_status: 'rejected',
      p_rejection_reason: 'ID mismatch',
    });
    expect(invoke).toHaveBeenCalledWith('send-notification', {
      body: { event: 'registration_rejected', request_id: 'req-1', kind: 'student' },
    });
  });

  it('sends null reason when blank', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    invoke.mockResolvedValue({ data: { success: true, sent: 1 }, error: null });

    await rejectStudentRegistrationRequest({ requestId: 'req-2', rejectionReason: '   ' });

    expect(rpc).toHaveBeenCalledWith('admin_review_student_request', {
      p_request_id: 'req-2',
      p_status: 'rejected',
      p_rejection_reason: null,
    });
  });

  it('does not send email when RPC fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'already reviewed' } });

    const result = await rejectStudentRegistrationRequest({
      requestId: 'req-3',
      rejectionReason: 'nope',
    });

    expect(result).toEqual({ ok: false, rpcError: 'already reviewed' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('returns email error without claiming delivery when invoke fails', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    invoke.mockResolvedValue({ data: null, error: { message: 'down' } });

    const result = await rejectStudentRegistrationRequest({
      requestId: 'req-4',
      rejectionReason: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.emailError).toContain('could not be sent');
      expect(result.alreadySent).toBe(false);
    }
  });
});
