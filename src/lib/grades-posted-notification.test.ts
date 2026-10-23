import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke } },
}));

import {
  emailGradesPosted,
  GRADES_EMAIL_FAILED,
} from '@/lib/grades-posted-notification';

describe('emailGradesPosted', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('invokes grades_posted with subject and items', async () => {
    invoke.mockResolvedValue({ data: { sent: 1, failed: 0 }, error: null });
    await emailGradesPosted('sub-1', [{ activity_id: 'a1', student_id: 'stu-1' }]);
    expect(invoke).toHaveBeenCalledWith('send-notification', {
      body: {
        event: 'grades_posted',
        subject_id: 'sub-1',
        items: [{ activity_id: 'a1', student_id: 'stu-1' }],
      },
    });
  });

  it('accepts multi-student bulk sent counts', async () => {
    invoke.mockResolvedValue({ data: { sent: 2, failed: 0 }, error: null });
    const result = await emailGradesPosted('sub-1', [
      { activity_id: 'a1', student_id: 'stu-1' },
      { activity_id: 'a1', student_id: 'stu-2' },
    ]);
    expect(result).toEqual({ emailError: null, alreadySent: false });
  });

  it('does not treat empty success bodies as delivered', async () => {
    invoke.mockResolvedValue({ data: { success: true, sent: 0, failed: 0 }, error: null });
    const result = await emailGradesPosted('sub-1', [{ activity_id: 'a1', student_id: 'stu-1' }]);
    expect(result).toEqual({ emailError: GRADES_EMAIL_FAILED, alreadySent: false });
  });

  it('surfaces provider failure', async () => {
    invoke.mockResolvedValue({ data: { sent: 0, failed: 1 }, error: null });
    const result = await emailGradesPosted('sub-1', [{ activity_id: 'a1', student_id: 'stu-1' }]);
    expect(result.emailError).toBe(GRADES_EMAIL_FAILED);
  });

  it('treats skipped responses as email failure', async () => {
    invoke.mockResolvedValue({ data: { sent: 0, skipped: 'no_recorded_score' }, error: null });
    const result = await emailGradesPosted('sub-1', [{ activity_id: 'a1', student_id: 'stu-1' }]);
    expect(result.emailError).toBe(GRADES_EMAIL_FAILED);
  });

  it('treats duplicate as already sent', async () => {
    invoke.mockResolvedValue({ data: { duplicate: true, sent: 0, failed: 0 }, error: null });
    const result = await emailGradesPosted('sub-1', [{ activity_id: 'a1', student_id: 'stu-1' }]);
    expect(result).toEqual({ emailError: null, alreadySent: true });
  });

  it('reports invoke network errors', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('network') });
    const result = await emailGradesPosted('sub-1', [{ activity_id: 'a1', student_id: 'stu-1' }]);
    expect(result).toEqual({ emailError: GRADES_EMAIL_FAILED, alreadySent: false });
  });
});
