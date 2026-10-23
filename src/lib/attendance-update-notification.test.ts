import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke } },
}));

import {
  emailAttendanceUpdate,
  ATTENDANCE_UPDATE_EMAIL_FAILED,
} from '@/lib/attendance-update-notification';

describe('emailAttendanceUpdate', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('invokes attendance_update on send-notification', async () => {
    invoke.mockResolvedValue({ data: { sent: 1, failed: 0 }, error: null });
    await emailAttendanceUpdate({
      studentId: 'stu-1',
      subjectId: 'sub-1',
      date: '2026-10-20',
      status: 'present',
    });
    expect(invoke).toHaveBeenCalledWith('send-notification', {
      body: {
        event: 'attendance_update',
        student_id: 'stu-1',
        subject_id: 'sub-1',
        date: '2026-10-20',
        status: 'present',
      },
    });
  });

  it('does not treat sent:0 as success', async () => {
    invoke.mockResolvedValue({ data: { success: true, sent: 0, failed: 0 }, error: null });
    const result = await emailAttendanceUpdate({
      studentId: 'stu-1',
      subjectId: 'sub-1',
      date: '2026-10-20',
      status: 'absent',
    });
    expect(result).toEqual({ emailError: ATTENDANCE_UPDATE_EMAIL_FAILED, alreadySent: false });
  });

  it('surfaces provider failure honestly', async () => {
    invoke.mockResolvedValue({ data: { sent: 0, failed: 1 }, error: null });
    const result = await emailAttendanceUpdate({
      studentId: 'stu-1',
      subjectId: 'sub-1',
      date: '2026-10-20',
      status: 'late',
    });
    expect(result.emailError).toBe(ATTENDANCE_UPDATE_EMAIL_FAILED);
  });

  it('treats duplicate as already sent', async () => {
    invoke.mockResolvedValue({ data: { duplicate: true, sent: 0 }, error: null });
    const result = await emailAttendanceUpdate({
      studentId: 'stu-1',
      subjectId: 'sub-1',
      date: '2026-10-20',
      status: 'present',
    });
    expect(result).toEqual({ emailError: null, alreadySent: true });
  });
});
