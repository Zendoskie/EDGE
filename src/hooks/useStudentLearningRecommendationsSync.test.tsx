import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { rpc, fromMock } = vi.hoisted(() => ({
  rpc: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc,
    from: fromMock,
  },
}));

import { useStudentLearningRecommendationsSync } from '@/hooks/useStudentLearningRecommendationsSync';
import { syncLearningRecommendationsForStudent } from '@/lib/learning-recommendations-sync';

vi.mock('@/lib/learning-recommendations-sync', () => ({
  syncLearningRecommendationsForStudent: vi.fn(),
}));

const syncMock = vi.mocked(syncLearningRecommendationsForStudent);

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useStudentLearningRecommendationsSync', () => {
  beforeEach(() => {
    rpc.mockReset();
    fromMock.mockReset();
    syncMock.mockReset();
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { risk_level: 'at_risk' }, error: null }),
    };
    fromMock.mockReturnValue(chain);
  });

  it('syncs once when latest risk is at_risk', async () => {
    syncMock.mockResolvedValue({ status: 'synced', inserted: 1 });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderHook(() => useStudentLearningRecommendationsSync('stu-1'), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => {
      expect(syncMock).toHaveBeenCalledTimes(1);
    });
    expect(syncMock).toHaveBeenCalledWith('stu-1', 'at_risk');
  });
});
