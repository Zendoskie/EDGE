import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FinalGradeReleasePanel, type ReleasePreview } from '@/components/FinalGradeReleasePanel';

const { invoke, fromCalls, state } = vi.hoisted(() => ({
  invoke: vi.fn(),
  fromCalls: [] as string[],
  state: { releases: [] as Array<Record<string, unknown>> },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      fromCalls.push(table);
      return { select: () => ({ eq: async () => ({ data: state.releases, error: null }) }) };
    },
    functions: { invoke },
  },
}));

const students = [
  { id: 's1', name: 'Ana Cruz' },
  { id: 's2', name: 'Ben Diaz' },
  { id: 's3', name: 'Cara Lim' },
];

const preview = new Map<string, ReleasePreview>([
  ['s1', { complete: true, missing: [], provisionalGrade: 88.5 }],
  ['s2', { complete: true, missing: [], provisionalGrade: 75 }],
  ['s3', { complete: false, missing: [{ kind: 'attendance_missing' }], provisionalGrade: 60 }],
]);

const httpError = (status: number, body: unknown) =>
  Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    context: new Response(JSON.stringify(body), { status }),
  });

function renderPanel(props: Partial<Parameters<typeof FinalGradeReleasePanel>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <FinalGradeReleasePanel
        subjectId="sub-1"
        students={students}
        preview={preview}
        hasUnsavedDrafts={false}
        previewMayBeIncomplete={false}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { invalidate };
}

async function confirmRelease() {
  fireEvent.click(await screen.findByRole('button', { name: /release final grades/i }));
  expect(await screen.findByText(/Release final grades for 2 of 3 enrolled students/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^release$/i }));
}

const defaultStudentIds = ['s1', 's2'];

beforeEach(() => {
  invoke.mockReset();
  fromCalls.length = 0;
  state.releases = [];
});

describe('FinalGradeReleasePanel', () => {
  it('shows the preview and current release status per student', async () => {
    state.releases = [
      { student_id: 's1', status: 'released', final_grade: 88.5, released_at: '2026-10-01', review_reason: null },
      { student_id: 's2', status: 'needs_review', final_grade: null, released_at: '2026-10-01', review_reason: 'weights_changed' },
    ];
    renderPanel();
    expect(await screen.findByText('Final 88.50%')).toBeTruthy();
    expect(screen.getByText('Under review')).toBeTruthy();
    expect(screen.getByText('Grading weights changed')).toBeTruthy();
    expect(screen.getByText('1 required missing')).toBeTruthy();
    expect(screen.getByText('No attendance recorded')).toBeTruthy();
    expect(screen.getByText('Provisional weighted: 60.00%')).toBeTruthy();
  });

  it('nothing is sent until the instructor confirms', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /release final grades/i }));
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));
    expect(invoke).not.toHaveBeenCalled();
  });

  it('a partial release reports counts and incomplete names, then refreshes only the subject release query', async () => {
    invoke.mockResolvedValue({
      data: {
        subject_id: 'sub-1',
        outcome: 'partial',
        released: 1,
        unchanged: 1,
        incomplete: [],
        not_enrolled: [],
      },
      error: null,
    });
    const { invalidate } = renderPanel();
    await confirmRelease();
    expect(await screen.findByText('Some final grades were released')).toBeTruthy();
    expect(screen.getByText(/1 released, 1 already final and unchanged, 0 incomplete among selected/)).toBeTruthy();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('release-final-grades', {
      body: { subject_id: 'sub-1', student_ids: defaultStudentIds },
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['final-grade-releases', 'subject', 'sub-1'] });
  });

  it('409: shows the conflict, no success, no automatic retry', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(409, {
        error: 'inputs_changed',
        retry: true,
        message: 'Grades changed during release. Nothing was released.',
        subject_id: 'sub-1',
      }),
    });
    renderPanel();
    await confirmRelease();
    expect(await screen.findByText('Nothing was released')).toBeTruthy();
    expect(screen.getByText('Grades changed during release. Nothing was released.')).toBeTruthy();
    expect(screen.queryByText(/were released|has a released final grade/)).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('a failed call or malformed body shows an error, never success, and does not touch release status', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: httpError(500, { error: 'Internal error' }) });
    const { invalidate } = renderPanel();
    await confirmRelease();
    expect(await screen.findByText('Release failed')).toBeTruthy();
    expect(screen.getByText(/No grades are shown as released from this attempt/)).toBeTruthy();
    expect(invalidate).not.toHaveBeenCalled();

    invoke.mockResolvedValueOnce({ data: { outcome: 'all_released' }, error: null });
    await confirmRelease();
    expect(await screen.findByText(/unexpected response/)).toBeTruthy();
    expect(screen.queryByText(/Every selected student has a released final grade/)).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('cannot start a second release while one is in flight', async () => {
    let finish: (v: unknown) => void = () => {};
    invoke.mockReturnValue(new Promise((r) => (finish = r)));
    renderPanel();
    await confirmRelease();
    const trigger = await screen.findByRole('button', { name: /releasing/i });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(trigger);
    expect(invoke).toHaveBeenCalledTimes(1);
    finish({
      data: { subject_id: 'sub-1', outcome: 'all_released', released: 3, unchanged: 0, incomplete: [], not_enrolled: [] },
      error: null,
    });
    expect(await screen.findByText('Every selected student has a released final grade')).toBeTruthy();
  });

  it('disables release while the gradebook has unsaved drafts', async () => {
    renderPanel({ hasUnsavedDrafts: true });
    expect(((await screen.findByRole('button', { name: /release final grades/i })) as HTMLButtonElement).disabled).toBe(true);
  });

  it('warns when the preview may be incomplete', async () => {
    renderPanel({ previewMayBeIncomplete: true });
    expect(await screen.findByText(/Preview may be incomplete/)).toBeTruthy();
  });

  it('30 students: one release request and one status read', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, name: `Student ${i}` }));
    const manyPreview = new Map(
      many.map((s) => [s.id, { complete: true, missing: [], provisionalGrade: 80 }] as const),
    );
    invoke.mockResolvedValue({
      data: { subject_id: 'sub-1', outcome: 'all_released', released: 30, unchanged: 0, incomplete: [], not_enrolled: [] },
      error: null,
    });
    renderPanel({ students: many, preview: manyPreview });
    await waitFor(() => expect(fromCalls).toHaveLength(1));
    fireEvent.click(await screen.findByRole('button', { name: /release final grades/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^release$/i }));
    expect(await screen.findByText('Every selected student has a released final grade')).toBeTruthy();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][1].body.student_ids).toHaveLength(30);
    await waitFor(() => expect(fromCalls).toHaveLength(2));
  });

  it('checks complete students by default and leaves incomplete students disabled', async () => {
    renderPanel();
    expect((await screen.findByLabelText('Include Ana Cruz in final grade release')).getAttribute('data-state')).toBe(
      'checked',
    );
    expect(screen.getByLabelText('Include Ben Diaz in final grade release').getAttribute('data-state')).toBe('checked');
    const cara = screen.getByLabelText('Include Cara Lim in final grade release');
    expect(cara.getAttribute('data-state')).toBe('unchecked');
    expect((cara as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends only selected student ids when a complete student is excluded', async () => {
    invoke.mockResolvedValue({
      data: {
        subject_id: 'sub-1',
        outcome: 'all_released',
        released: 1,
        unchanged: 0,
        incomplete: [],
        not_enrolled: [],
      },
      error: null,
    });
    renderPanel();
    fireEvent.click(screen.getByLabelText('Include Ben Diaz in final grade release'));
    fireEvent.click(await screen.findByRole('button', { name: /release final grades/i }));
    expect(await screen.findByText(/1 complete student excluded/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^release$/i }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke).toHaveBeenCalledWith('release-final-grades', {
      body: { subject_id: 'sub-1', student_ids: ['s1'] },
    });
  });

  it('disables release when no students are selected', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /clear selection/i }));
    expect(((await screen.findByRole('button', { name: /release final grades/i })) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
