import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc },
}));

import { syncLearningRecommendationsForStudent } from '@/lib/learning-recommendations-sync';

describe('syncLearningRecommendationsForStudent', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('skips stable students', async () => {
    const result = await syncLearningRecommendationsForStudent('stu-1', 'stable');
    expect(result.status).toBe('skipped');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('syncs vulnerable students via RPC', async () => {
    rpc.mockResolvedValue({ data: 1, error: null });
    const result = await syncLearningRecommendationsForStudent('stu-1', 'at_risk');
    expect(result).toEqual({ status: 'synced', inserted: 1 });
    expect(rpc).toHaveBeenCalledWith('sync_learning_recommendations_for_student', {
      p_student_id: 'stu-1',
    });
  });

  it('surfaces RPC failures', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'down' } });
    const result = await syncLearningRecommendationsForStudent('stu-1', 'critical');
    expect(result).toEqual({ status: 'failed', message: 'down' });
  });
});
