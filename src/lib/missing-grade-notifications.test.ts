import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, invoke, from } = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc,
    from,
    functions: { invoke },
  },
}));

vi.mock('sonner', () => ({
  toast: { message: vi.fn() },
}));

import { toast } from 'sonner';
import { activityIdsWithAtLeastOneRecordedScore } from '@/lib/missing-grade-eligibility';
import { publishMissingGradeAlerts, publishMissingGradeAlertsForSubject } from '@/lib/missing-grade-notifications';

describe('missing grade alerts', () => {
  beforeEach(() => {
    rpc.mockReset();
    invoke.mockReset();
    from.mockReset();
    vi.mocked(toast.message).mockReset();
  });

  it('notifies every returned student when an activity has no saved scores', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          student_id: 'student-1',
          email: 'ana@example.com',
          notification_body: 'You have a missing grade for Activity 1 in PL101.',
          subject_code: 'PL101',
          subject_name: 'Programming Logic',
        },
        {
          student_id: 'student-2',
          email: 'ben@example.com',
          notification_body: 'You have a missing grade for Activity 1 in PL101.',
          subject_code: 'PL101',
          subject_name: 'Programming Logic',
        },
      ],
      error: null,
    });
    invoke.mockResolvedValue({ data: { success: true, mode: 'single' }, error: null });

    await publishMissingGradeAlerts('sub-1', ['activity-1']);

    expect(rpc).toHaveBeenCalledWith('notify_missing_activity_grades', { p_activity_id: 'activity-1' });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledWith('send-notification', {
      body: expect.objectContaining({
        to: 'ana@example.com',
        body: 'You have a missing grade for Activity 1 in PL101.',
      }),
    });
  });

  it('only calls the RPC for activities that already have a recorded score', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'activities') {
        return {
          select: () => ({
            eq: async () => ({
              data: [{ id: 'activity-1' }, { id: 'activity-2' }],
              error: null,
            }),
          }),
        };
      }
      if (table === 'submissions') {
        return {
          select: () => ({
            in: async () => ({
              data: [{ activity_id: 'activity-2', score: 72 }],
              error: null,
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
    rpc.mockResolvedValue({ data: [], error: null });

    await publishMissingGradeAlertsForSubject('sub-1');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('notify_missing_activity_grades', { p_activity_id: 'activity-2' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('skips enrollment-wide publish when no activity has a recorded score', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'activities') {
        return {
          select: () => ({
            eq: async () => ({ data: [{ id: 'activity-1' }], error: null }),
          }),
        };
      }
      if (table === 'submissions') {
        return {
          select: () => ({
            in: async () => ({ data: [{ activity_id: 'activity-1', score: null }], error: null }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    await publishMissingGradeAlertsForSubject('sub-1');

    expect(rpc).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('toasts when invoke succeeds but no email was sent', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          student_id: 'student-1',
          email: 'ana@example.com',
          notification_body: 'Missing grade',
          subject_code: 'PL101',
          subject_name: 'Programming Logic',
        },
      ],
      error: null,
    });
    invoke.mockResolvedValue({ data: { success: true, sent: 0, failed: 0 }, error: null });

    await publishMissingGradeAlerts('sub-1', ['activity-1']);

    expect(toast.message).toHaveBeenCalledWith(
      'Missing-grade alert saved. The email notification could not be sent.',
    );
  });

  it('does not toast on legacy single-send success', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          student_id: 'student-1',
          email: 'ana@example.com',
          notification_body: 'Missing grade',
          subject_code: 'PL101',
          subject_name: 'Programming Logic',
        },
      ],
      error: null,
    });
    invoke.mockResolvedValue({ data: { success: true, mode: 'single' }, error: null });

    await publishMissingGradeAlerts('sub-1', ['activity-1']);

    expect(toast.message).not.toHaveBeenCalled();
  });

  it('A1 and ME recorded, P1 ungraded — P1 is not eligible for missing-grade RPC', () => {
    const eligible = activityIdsWithAtLeastOneRecordedScore([
      { activity_id: 'a1', score: 16 },
      { activity_id: 'p1', score: null },
      { activity_id: 'me', score: 45 },
    ]);
    expect(eligible.sort()).toEqual(['a1', 'me']);
  });

  it('P1 becomes eligible once any student has a recorded score of zero', () => {
    const eligible = activityIdsWithAtLeastOneRecordedScore([
      { activity_id: 'p1', score: 0 },
    ]);
    expect(eligible).toEqual(['p1']);
  });

  it('toasts on invoke transport errors', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          student_id: 'student-1',
          email: 'ana@example.com',
          notification_body: 'Missing grade',
          subject_code: 'PL101',
          subject_name: 'Programming Logic',
        },
      ],
      error: null,
    });
    invoke.mockResolvedValue({ data: null, error: { message: 'down' } });

    await publishMissingGradeAlerts('sub-1', ['activity-1']);

    expect(toast.message).toHaveBeenCalledWith(
      'Missing-grade alert saved. The email notification could not be sent.',
    );
  });
});
