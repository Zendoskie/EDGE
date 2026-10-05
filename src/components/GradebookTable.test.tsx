import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GradebookTable } from '@/components/GradebookTable';

vi.mock('@/lib/recalculate-risk', () => ({
  recalculateSubjectRisk: async () => ({ ok: true, count: 0 }),
}));

const { upsert, rpc, invoke } = vi.hoisted(() => ({
  upsert: vi.fn(async () => ({ error: null })),
  rpc: vi.fn(async () => ({ data: [] as Array<Record<string, string>>, error: null })),
  invoke: vi.fn(async () => ({ data: { success: true }, error: null })),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'enrollments') {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({
                data: [
                  { id: 'e1', student_id: 's1', subject_id: 'sub-1', status: 'active' },
                  { id: 'e2', student_id: 's2', subject_id: 'sub-1', status: 'active' },
                  { id: 'e3', student_id: 's3', subject_id: 'sub-1', status: 'pending' },
                ],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            in: async () => ({
              data: [
                { user_id: 's1', full_name: 'Ana Cruz', student_id: '23-1', email: 'ana@example.com' },
                { user_id: 's2', full_name: 'Ben Diaz', student_id: '23-2', email: 'ben@example.com' },
                { user_id: 's3', full_name: 'Pending Student', student_id: '23-3', email: 'pending@example.com' },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === 'subjects') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { code: 'PL101', name: 'Programming Logic' },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          in: async () => ({
            data: [
              { id: 'grade-1', activity_id: 'quiz-1', student_id: 's1', score: 40 },
            ],
            error: null,
          }),
        }),
        upsert,
      };
    },
    rpc,
    functions: { invoke },
  },
}));

const activities = [
  {
    id: 'act-1',
    title: 'Activity 1',
    type: 'activity',
    max_score: 100,
    subject_id: 'sub-1',
    created_at: '2026-01-01',
  },
  {
    id: 'quiz-1',
    title: 'Quiz 1',
    type: 'quiz',
    max_score: 50,
    subject_id: 'sub-1',
    created_at: '2026-01-02',
  },
];

function renderGradebook() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GradebookTable subjectId="sub-1" userId="instructor-1" activities={activities} />
    </QueryClientProvider>,
  );
}

describe('GradebookTable', () => {
  it('shows assessments as columns and existing grades', async () => {
    renderGradebook();
    expect(await screen.findByText('Activity 1')).toBeTruthy();
    expect(screen.getByText('Quiz 1')).toBeTruthy();
    expect(screen.getByText('Ana Cruz')).toBeTruthy();
    expect(screen.getByText('Ben Diaz')).toBeTruthy();
    expect(screen.queryByText('Pending Student')).toBeNull();
    expect(screen.getByDisplayValue('40')).toBeTruthy();
    expect(screen.getAllByPlaceholderText('Missing').length).toBeGreaterThan(0);
  });

  it('does not write to the database when nothing changed', async () => {
    upsert.mockClear();
    rpc.mockClear();
    renderGradebook();
    fireEvent.click(await screen.findByRole('button', { name: /save grades/i }));
    await waitFor(() => expect(upsert).not.toHaveBeenCalled());
    expect(rpc).not.toHaveBeenCalled();
  });

  it('upserts only the edited grade for the matching student and assessment', async () => {
    upsert.mockClear();
    invoke.mockClear();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: [], error: null });
    renderGradebook();
    const activityInput = await screen.findByLabelText('Ben Diaz Activity 1');
    fireEvent.change(activityInput, { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: /save grades/i }));
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    const [rows, options] = upsert.mock.calls[0];
    expect(rows).toEqual([
      expect.objectContaining({
        activity_id: 'act-1',
        student_id: 's2',
        score: 80,
        assessment_type: 'activity',
      }),
    ]);
    expect(options).toEqual({ onConflict: 'activity_id,student_id' });
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledWith(
      'send-notification',
      expect.objectContaining({
        body: expect.objectContaining({
          to: 'ben@example.com',
          student_id: 's2',
          subject_code: 'PL101',
          body: expect.stringContaining('A grade is now available for PL101.'),
        }),
      }),
    );
  });

  it('notifies only the still-ungraded student after a grade is published', async () => {
    upsert.mockClear();
    rpc.mockClear();
    invoke.mockClear();
    rpc.mockResolvedValueOnce({
      data: [
        {
          student_id: 's1',
          email: 'ana@example.com',
          notification_body: 'You have a missing grade for Activity 1 in PL101.',
          subject_code: 'PL101',
          subject_name: 'Programming Logic',
        },
      ],
      error: null,
    });
    renderGradebook();
    const activityInput = await screen.findByLabelText('Ben Diaz Activity 1');
    fireEvent.change(activityInput, { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: /save grades/i }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('notify_missing_activity_grades', { p_activity_id: 'act-1' }),
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'send-notification',
        expect.objectContaining({
          body: expect.objectContaining({
            to: 'ana@example.com',
            student_id: 's1',
            subject_id: 'sub-1',
            subject_code: 'PL101',
            body: 'You have a missing grade for Activity 1 in PL101.',
          }),
        }),
      ),
    );
    const missingCalls = invoke.mock.calls.filter((call) =>
      String((call[1] as { body?: { body?: string } })?.body?.body ?? '').includes('missing grade'),
    );
    expect(missingCalls).toHaveLength(1);
  });

  it('blocks an invalid grade before saving', async () => {
    upsert.mockClear();
    renderGradebook();
    const activityInput = await screen.findByLabelText('Ana Cruz Activity 1');
    fireEvent.change(activityInput, { target: { value: '150' } });
    expect(screen.getByText(/cannot exceed 100/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /save grades/i }));
    expect(upsert).not.toHaveBeenCalled();
  });
});
