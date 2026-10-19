import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GradebookTable } from '@/components/GradebookTable';

vi.mock('@/lib/recalculate-risk', () => ({
  recalculateSubjectRisk: async () => ({ ok: true, count: 0 }),
}));

const { upsert, rpc, invoke, fromCalls, state } = vi.hoisted(() => ({
  upsert: vi.fn(async () => ({ error: null })),
  rpc: vi.fn(async () => ({ data: [] as Array<Record<string, string>>, error: null })),
  invoke: vi.fn(async () => ({ data: { success: true }, error: null })),
  fromCalls: [] as string[],
  state: {
    submissions: [] as Array<Record<string, unknown>>,
    releases: [] as Array<Record<string, unknown>>,
  },
}));

const DEFAULT_SUBMISSIONS = [
  { id: 'grade-1', activity_id: 'quiz-1', student_id: 's1', score: 40, assessment_type: 'quiz' },
];

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      fromCalls.push(table);
      if (table === 'final_grade_releases') {
        return { select: () => ({ eq: async () => ({ data: state.releases, error: null }) }) };
      }
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
          in: async () => ({ data: state.submissions, error: null }),
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

type GradebookExtras = {
  gradingSystem?: { activity_weight: number; project_weight: number; attendance_weight: number; exam_weight: number } | null;
  attendance?: Array<{ student_id: string | null; status: string }>;
};

function renderGradebook(extras: GradebookExtras = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GradebookTable subjectId="sub-1" userId="instructor-1" activities={activities} {...extras} />
    </QueryClientProvider>,
  );
}

const ACTIVITY_ONLY = { activity_weight: 100, project_weight: 0, attendance_weight: 0, exam_weight: 0 };

beforeEach(() => {
  state.submissions = [...DEFAULT_SUBMISSIONS];
  state.releases = [];
  fromCalls.length = 0;
});

describe('GradebookTable', () => {
  it('shows assessments as columns and existing grades', async () => {
    renderGradebook();
    expect(await screen.findByText('Activity 1')).toBeTruthy();
    expect(screen.getByText('Quiz 1')).toBeTruthy();
    expect(screen.getByLabelText('Ana Cruz Activity 1')).toBeTruthy();
    expect(screen.getByLabelText('Ben Diaz Activity 1')).toBeTruthy();
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
          event: 'grades_posted',
          subject_id: 'sub-1',
          items: [{ activity_id: 'act-1', student_id: 's2' }],
        }),
      }),
    );
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('ben@example.com');
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('A grade is now available');
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

describe('GradebookTable required-grade indicator (Phase 3B completeness rules)', () => {
  it('counts missing rows as missing and a real zero as entered', async () => {
    state.submissions = [
      { id: 'g1', activity_id: 'quiz-1', student_id: 's1', score: 40, assessment_type: 'quiz' },
      { id: 'g2', activity_id: 'act-1', student_id: 's1', score: 0, assessment_type: 'activity' },
      { id: 'g3', activity_id: 'act-1', student_id: 's2', score: null, assessment_type: 'activity' },
    ];
    renderGradebook({ gradingSystem: ACTIVITY_ONLY, attendance: [] });
    expect((await screen.findAllByText('All required grades entered')).length).toBe(1);
    const ben = screen.getByRole('button', { name: 'Ben Diaz: 2 required grades missing' });
    fireEvent.click(ben);
    const popover = within(await screen.findByRole('dialog'));
    expect(popover.getByText('Activity 1 (Activity): no score')).toBeTruthy();
    expect(popover.getByText('Quiz 1 (Quiz): no score')).toBeTruthy();
  });

  it('applies configured weights and the exam split: zero-weight categories are not required', async () => {
    renderGradebook({
      gradingSystem: { activity_weight: 0, project_weight: 0, attendance_weight: 0, exam_weight: 100 },
      attendance: [],
    });
    const ana = await screen.findByRole('button', { name: 'Ana Cruz: 2 required grades missing' });
    fireEvent.click(ana);
    const popover = within(await screen.findByRole('dialog'));
    expect(popover.getByText('No Midterm Exam assessment yet')).toBeTruthy();
    expect(popover.getByText('No Final Exam assessment yet')).toBeTruthy();
    expect(screen.queryByText(/Activity 1 \(Activity\): no score/)).toBeNull();
  });

  it('requires attendance when it is weighted and ignores drafts until saved', async () => {
    renderGradebook({
      gradingSystem: { activity_weight: 50, project_weight: 0, attendance_weight: 50, exam_weight: 0 },
      attendance: [{ student_id: 's1', status: 'present' }, { student_id: 's2', status: 'excused' }],
    });
    expect(await screen.findByRole('button', { name: 'Ana Cruz: 1 required grade missing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ben Diaz: 3 required grades missing' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Ben Diaz Activity 1'), { target: { value: '80' } });
    expect(screen.getByRole('button', { name: 'Ben Diaz: 3 required grades missing' })).toBeTruthy();
    expect(screen.getByText(/Save grades first/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /release final grades/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows no indicator while weights or attendance are still loading', async () => {
    renderGradebook({ attendance: [] });
    expect(await screen.findByText('Activity 1')).toBeTruthy();
    expect(screen.queryByText('All required grades entered')).toBeNull();
    expect(screen.queryByRole('button', { name: /required grades? missing/ })).toBeNull();
  });

  it('reads release status with one subject-scoped query, not one per student', async () => {
    state.releases = [
      { student_id: 's1', status: 'released', final_grade: 88.5, released_at: '2026-10-01', review_reason: null },
      { student_id: 's2', status: 'needs_review', final_grade: null, released_at: '2026-10-01', review_reason: 'score_changed' },
    ];
    renderGradebook({ gradingSystem: ACTIVITY_ONLY, attendance: [] });
    expect(await screen.findByText('Final 88.50%')).toBeTruthy();
    expect(screen.getByText('Under review')).toBeTruthy();
    expect(screen.getByText('A score changed')).toBeTruthy();
    expect(fromCalls.filter((t) => t === 'final_grade_releases')).toHaveLength(1);
  });

  it('refreshes only the subject release query after grades are saved', async () => {
    renderGradebook({ gradingSystem: ACTIVITY_ONLY, attendance: [] });
    fireEvent.change(await screen.findByLabelText('Ben Diaz Activity 1'), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: /save grades/i }));
    await waitFor(() => expect(upsert).toHaveBeenCalled());
    await waitFor(() => expect(fromCalls.filter((t) => t === 'final_grade_releases')).toHaveLength(2));
  });
});
