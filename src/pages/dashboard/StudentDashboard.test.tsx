import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import StudentDashboard from '@/pages/dashboard/StudentDashboard';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'test-student-id', user_metadata: { course: 'BSIT', year_level: '1st Year' } },
    role: 'student',
  }),
}));

vi.mock('@/hooks/useCounselingReferrals', () => ({
  useCounselingReferrals: () => ({ data: [], isLoading: false }),
}));

const chain = () => ({
  select: () => chain(),
  eq: () => chain(),
  in: () => chain(),
  order: () => chain(),
  limit: () => chain(),
  not: () => chain(),
  maybeSingle: async () => ({ data: null, error: null }),
  then: undefined,
});
const asyncChain = {
  ...chain(),
  then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'programs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { code: 'BSIT', name: 'BSIT' }, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
            maybeSingle: async () => ({ data: null, error: null }),
          }),
          in: () => ({
            order: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
          }),
          not: () => ({
            order: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      };
    },
  },
}));

vi.mock('@/lib/student-performance-scope', () => ({
  fetchActiveEnrolledSubjectIds: async () => [],
  filterAttendanceBySubjectIds: (rows: unknown[]) => rows,
  filterPredictionsBySubjectIds: (rows: unknown[]) => rows,
  filterSubmissionsByActiveSubjects: (rows: unknown[]) => rows,
  pickLatestPredictionByCreatedAt: () => null,
  resolveStudentRiskSummary: () => ({
    resolvedLevel: null,
    riskSource: 'derived',
    riskStatusLabel: '—',
    recommendation: null,
    subjectLabel: null,
  }),
}));

describe('StudentDashboard', () => {
  it('renders without crashing', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <StudentDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Student Dashboard/i)).toBeTruthy();
    expect(await screen.findByText(/My Engagement/i)).toBeTruthy();
  });
});
