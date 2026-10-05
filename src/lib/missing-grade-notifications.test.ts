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

import { publishMissingGradeAlerts, publishMissingGradeAlertsForSubject } from '@/lib/missing-grade-notifications';

describe('missing grade alerts', () => {
  beforeEach(() => {
    rpc.mockReset();
    invoke.mockReset();
    from.mockReset();
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
    invoke.mockResolvedValue({ error: null });

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

  it('asks for alerts for every activity in a subject after a student becomes active', async () => {
    from.mockReturnValue({
      select: () => ({
        eq: async () => ({ data: [{ id: 'activity-1' }, { id: 'activity-2' }], error: null }),
      }),
    });
    rpc.mockResolvedValue({ data: [], error: null });

    await publishMissingGradeAlertsForSubject('sub-1');

    expect(rpc).toHaveBeenNthCalledWith(1, 'notify_missing_activity_grades', { p_activity_id: 'activity-1' });
    expect(rpc).toHaveBeenNthCalledWith(2, 'notify_missing_activity_grades', { p_activity_id: 'activity-2' });
    expect(invoke).not.toHaveBeenCalled();
  });
});
