import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SubjectAttendance } from '@/pages/dashboard/SubjectDetail';

const { rpc, toastError, attendanceReads } = vi.hoisted(() => ({
  rpc: vi.fn(),
  toastError: vi.fn(),
  attendanceReads: { count: 0 },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }));
vi.mock('@/lib/recalculate-risk', () => ({
  recalculateSubjectRisk: async () => ({ ok: true, count: 0 }),
  scheduleSubjectRiskRecalc: vi.fn(),
  flushSubjectRiskRecalc: vi.fn(),
}));

const DATA: Record<string, unknown[]> = {
  enrollments: [
    { id: 'e1', student_id: 's1', subject_id: 'sub-1', status: 'active' },
    { id: 'e2', student_id: 's2', subject_id: 'sub-1', status: 'active' },
  ],
  profiles: [
    { user_id: 's1', full_name: 'Ana Cruz' },
    { user_id: 's2', full_name: 'Ben Diaz' },
  ],
  attendance: [],
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const result = { data: DATA[table] ?? [], error: null };
      const chain: Record<string, unknown> = {
        select: (cols: string) => {
          if (table === 'attendance' && cols === '*') attendanceReads.count++;
          return chain;
        },
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        then: (resolve: (v: typeof result) => unknown) => resolve(result),
      };
      return chain;
    },
    rpc,
  },
}));

type RpcResult = { data: unknown; error: { code: string; message: string } | null };
const deferred = () => {
  let resolve!: (v: RpcResult) => void;
  const promise = new Promise<RpcResult>((r) => (resolve = r));
  return { promise, resolve };
};

const renderAttendance = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SubjectAttendance subjectId="sub-1" />
    </QueryClientProvider>,
  );

const buttonsFor = async (name: string) => {
  const row = (await screen.findByText(name)).closest('tr') as HTMLElement;
  return within(row).getAllByRole('button');
};

describe('SubjectAttendance marking safeguard', () => {
  beforeEach(() => {
    rpc.mockReset();
    toastError.mockReset();
    attendanceReads.count = 0;
  });

  it('disables only the student being saved, ignores repeat clicks, and re-enables after success', async () => {
    const call = deferred();
    rpc.mockReturnValueOnce(call.promise);
    renderAttendance();
    const ana = await buttonsFor('Ana Cruz');
    const ben = await buttonsFor('Ben Diaz');

    fireEvent.click(ana[1]);
    fireEvent.click(ana[1]);
    fireEvent.click(ana[2]);

    await waitFor(() => expect(ana.every((b) => (b as HTMLButtonElement).disabled)).toBe(true));
    expect(ben.some((b) => (b as HTMLButtonElement).disabled)).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('record_attendance', expect.objectContaining({ p_student_id: 's1', p_status: 'absent' }));

    call.resolve({ data: [{ id: 'a1', student_id: 's1', status: 'absent', date: '2026-10-13' }], error: null });
    await waitFor(() => expect(ana.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('still lets another student be marked while one save is in flight', async () => {
    const first = deferred();
    const second = deferred();
    rpc.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderAttendance();
    const ana = await buttonsFor('Ana Cruz');
    const ben = await buttonsFor('Ben Diaz');

    fireEvent.click(ana[1]);
    fireEvent.click(ben[2]);

    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(rpc).toHaveBeenLastCalledWith('record_attendance', expect.objectContaining({ p_student_id: 's2', p_status: 'late' }));
    first.resolve({ data: [], error: null });
    second.resolve({ data: [], error: null });
    await waitFor(() => expect([...ana, ...ben].every((b) => !(b as HTMLButtonElement).disabled)).toBe(true));
  });

  it('on a technical failure shows a plain message, re-enables the controls and reloads that date once', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '40P01', message: 'deadlock detected' } });
    renderAttendance();
    const ana = await buttonsFor('Ana Cruz');
    await waitFor(() => expect(attendanceReads.count).toBe(1));

    fireEvent.click(ana[1]);

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Attendance wasn't saved. Please try again."));
    await waitFor(() => expect(attendanceReads.count).toBe(2));
    await waitFor(() => expect(ana.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true));
  });

  it('shows the attendance rule message when the server refuses the mark', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'Student was not yet enrolled on this date.' } });
    renderAttendance();
    const ana = await buttonsFor('Ana Cruz');

    fireEvent.click(ana[0]);

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Student was not yet enrolled on this date.'));
    await waitFor(() => expect(ana.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true));
  });
});
