import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import {
  RELEASE_QUERY_FRESHNESS,
  useStudentFinalGradeReleases,
  useSubjectFinalGradeReleases,
} from '@/hooks/useFinalGradeReleases';
import { FinalGradeBadge } from '@/components/FinalGradeBadge';
import { studentReleaseKey } from '@/lib/final-grade-freshness';

const { calls, state } = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; columns: string; filter: [string, string] }>,
  state: {
    rows: [] as Array<Record<string, unknown>>,
    error: null as null | { message: string },
  },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: async (col: string, value: string) => {
          calls.push({ table, columns, filter: [col, value] });
          return state.error ? { data: null, error: state.error } : { data: state.rows, error: null };
        },
      }),
    }),
  },
}));

/** Mirrors the App QueryClient defaults the release hooks override. */
function appClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: false } },
  });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  calls.length = 0;
  state.rows = [];
  state.error = null;
});

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

describe('release query paths', () => {
  it('student hook: one read of final_grade_releases filtered to the student (RLS scopes it further)', async () => {
    const { result } = renderHook(() => useStudentFinalGradeReleases('stu-1'), { wrapper: wrapperFor(appClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls).toEqual([
      { table: 'final_grade_releases', columns: 'subject_id, status, final_grade', filter: ['student_id', 'stu-1'] },
    ]);
  });

  it('subject hook: one read filtered to the subject', async () => {
    const { result } = renderHook(() => useSubjectFinalGradeReleases('sub-1'), { wrapper: wrapperFor(appClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls).toEqual([
      {
        table: 'final_grade_releases',
        columns: 'student_id, status, final_grade, released_at, review_reason',
        filter: ['subject_id', 'sub-1'],
      },
    ]);
  });

  it('does not query without an id', async () => {
    renderHook(() => useStudentFinalGradeReleases(undefined), { wrapper: wrapperFor(appClient()) });
    renderHook(() => useSubjectFinalGradeReleases(null), { wrapper: wrapperFor(appClient()) });
    await act(async () => {});
    expect(calls).toHaveLength(0);
  });
});

describe('approved F2 freshness settings', () => {
  it('uses exactly the approved interval, no background polling, and focus refetch', () => {
    expect(RELEASE_QUERY_FRESHNESS).toEqual({
      refetchInterval: 180_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: 'always',
    });
  });

  it('refetches at 180 000 ms, not at 179 999 ms, while the tab is visible', async () => {
    vi.useFakeTimers();
    renderHook(() => useStudentFinalGradeReleases('stu-1'), { wrapper: wrapperFor(appClient()) });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(calls).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(179_999));
    expect(calls).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(calls).toHaveLength(2);
    await act(() => vi.advanceTimersByTimeAsync(180_000));
    expect(calls).toHaveLength(3);
  });

  it('does not poll while the tab is hidden', async () => {
    vi.useFakeTimers();
    renderHook(() => useSubjectFinalGradeReleases('sub-1'), { wrapper: wrapperFor(appClient()) });
    await act(() => vi.advanceTimersByTimeAsync(0));
    act(() => focusManager.setFocused(false));
    await act(() => vi.advanceTimersByTimeAsync(360_000));
    expect(calls).toHaveLength(1);
  });

  it('refetches on return to the tab even while the data is still fresh', async () => {
    vi.useFakeTimers();
    renderHook(() => useStudentFinalGradeReleases('stu-1'), { wrapper: wrapperFor(appClient()) });
    await act(() => vi.advanceTimersByTimeAsync(0));
    act(() => focusManager.setFocused(false));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    act(() => focusManager.setFocused(true));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(calls).toHaveLength(2);
  });

  it('several views of the same student share one query per interval', async () => {
    vi.useFakeTimers();
    const wrapper = wrapperFor(appClient());
    renderHook(() => useStudentFinalGradeReleases('stu-1'), { wrapper });
    renderHook(() => useStudentFinalGradeReleases('stu-1'), { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(calls).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(180_000));
    expect(calls).toHaveLength(2);
  });
});

function StudentStatus({ studentId, provisionalGrade }: { studentId: string; provisionalGrade: number | null }) {
  const q = useStudentFinalGradeReleases(studentId);
  return (
    <div data-testid="status">
      <FinalGradeBadge
        release={q.data?.find((r) => r.subject_id === 'pl') ?? null}
        provisionalGrade={provisionalGrade}
        loading={q.isLoading}
        error={q.isError}
      />
    </div>
  );
}

describe('Student and Parent badge states', () => {
  const renderStatus = (client: QueryClient, provisionalGrade: number | null = 72.4) =>
    render(
      <QueryClientProvider client={client}>
        <StudentStatus studentId="stu-1" provisionalGrade={provisionalGrade} />
      </QueryClientProvider>,
    );

  it('no release row: Provisional plus the provisional weighted grade', async () => {
    renderStatus(appClient());
    expect(await screen.findByText('Provisional')).toBeTruthy();
    expect(screen.getByText('Provisional weighted: 72.40%')).toBeTruthy();
    expect(screen.queryByText(/^Final/)).toBeNull();
  });

  it('released: Final with the released grade only', async () => {
    state.rows = [{ subject_id: 'pl', status: 'released', final_grade: 88.5 }];
    renderStatus(appClient());
    expect(await screen.findByText('Final 88.50%')).toBeTruthy();
    expect(screen.queryByText(/Provisional/)).toBeNull();
  });

  it('a refetch that returns needs_review replaces the Final; the prior 88.50 is never shown', async () => {
    state.rows = [{ subject_id: 'pl', status: 'released', final_grade: 88.5 }];
    const client = appClient();
    renderStatus(client);
    expect(await screen.findByText('Final 88.50%')).toBeTruthy();
    state.rows = [{ subject_id: 'pl', status: 'needs_review', final_grade: null }];
    await act(() => client.invalidateQueries({ queryKey: studentReleaseKey('stu-1') }));
    expect(await screen.findByText('Under review')).toBeTruthy();
    expect(screen.getByTestId('status').textContent).not.toContain('88.50');
    expect(screen.getByText('Provisional weighted: 72.40%')).toBeTruthy();
  });

  it('a failed read shows Status unavailable, never a Final kept from earlier data', async () => {
    state.rows = [{ subject_id: 'pl', status: 'released', final_grade: 88.5 }];
    const client = appClient();
    renderStatus(client);
    expect(await screen.findByText('Final 88.50%')).toBeTruthy();
    state.error = { message: 'network down' };
    await act(() => client.invalidateQueries({ queryKey: studentReleaseKey('stu-1') }));
    expect(await screen.findByText('Status unavailable')).toBeTruthy();
    expect(screen.getByTestId('status').textContent).not.toContain('Final');
  });

  it('needs_review with no provisional grade shows only Under review', async () => {
    state.rows = [{ subject_id: 'pl', status: 'needs_review', final_grade: 91 }];
    renderStatus(appClient(), null);
    expect(await screen.findByText('Under review')).toBeTruthy();
    expect(screen.getByTestId('status').textContent).toBe('Under review');
  });
});
