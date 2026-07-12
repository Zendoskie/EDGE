import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { StudentEngagementCard } from '@/components/StudentEngagementCard';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'test-student-id' } }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  },
}));

describe('StudentEngagementCard', () => {
  it('renders without crashing when no summary exists', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <StudentEngagementCard />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Student Engagement/i)).toBeTruthy();
  });
});
