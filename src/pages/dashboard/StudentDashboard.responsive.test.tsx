import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import StudentDashboard from '@/pages/dashboard/StudentDashboard';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'test-student-id' },
    role: 'student',
  }),
}));

vi.mock('@/hooks/useCounselingReferrals', () => ({
  useCounselingReferrals: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/hooks/useActivityTracker', () => ({
  useTrackPageView: () => {},
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          order: () => ({
            limit: async () => ({ data: [], error: null }),
          }),
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
    }),
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

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

describe('StudentDashboard responsive layout', () => {
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalInnerWidth });
  });

  for (const vp of VIEWPORTS) {
    it(`renders core sections at ${vp.name} (${vp.width}px)`, async () => {
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: vp.width });
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <StudentDashboard />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      expect(await screen.findByText(/Student Dashboard/i)).toBeTruthy();
      expect(await screen.findByText(/Student Engagement/i)).toBeTruthy();
    });
  }
});
