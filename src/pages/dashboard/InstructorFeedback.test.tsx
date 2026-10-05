import { describe, expect, it, vi } from 'vitest';

const { rpc, toastSuccess } = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: null, error: null })),
  toastSuccess: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: vi.fn(), message: vi.fn() },
}));
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import InstructorFeedback, { InstructorFeedbackSummary } from '@/pages/dashboard/InstructorFeedback';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'instructor-1' },
    role: 'instructor',
  }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc,
    from: (table: string) => {
      if (table === 'subjects') {
        return {
          select: () => ({
            eq: async () => ({
              data: [{ id: 'sub-1', code: 'PL101', name: 'Programming Logic' }],
              error: null,
            }),
          }),
        };
      }
      if (table === 'enrollments') {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({
                data: [{ student_id: 'student-1' }],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'student_feedback') {
        return {
          select: () => ({
            in: () => ({
              order: async () => ({
                data: [{
                  id: 'risk-1',
                  created_at: '2026-10-05T08:00:00.000Z',
                  student_id: 'student-1',
                  subject_id: 'sub-1',
                  risk_level: 'at_risk',
                  reasons: ['Need more time'],
                  details: 'I missed the review session.',
                }],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'student_engagement_feedback') {
        return {
          select: () => ({
            in: () => ({
              order: async () => ({
                data: [{
                  id: 'eng-1',
                  created_at: '2026-10-05T09:00:00.000Z',
                  student_id: 'student-1',
                  subject: 'PL101',
                  message: 'The pace of Activity 1 is hard to follow.',
                  status: 'submitted',
                  counselor_remarks: null,
                }],
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
              data: [{
                user_id: 'student-1',
                full_name: 'Ana Cruz',
                email: 'ana@example.com',
                student_id: '23-1',
              }],
              error: null,
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <InstructorFeedback />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Instructor feedback section', () => {
  it('shows a count summary without the feedback message', () => {
    render(
      <MemoryRouter>
        <InstructorFeedbackSummary pending={2} total={5} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Student Feedback')).toBeTruthy();
    expect(screen.getByText('2 Pending · 5 total')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open feedback' })).toHaveAttribute(
      'href',
      '/dashboard/instructor-feedback',
    );
    expect(screen.queryByText(/hard to follow/i)).toBeNull();
  });

  it('lists the student, subject, status, and full message', async () => {
    renderPage();

    expect(await screen.findAllByText(/Ana Cruz — PL101/)).toHaveLength(2);
    expect(screen.getByText('The pace of Activity 1 is hard to follow.')).toBeTruthy();
    expect(screen.getByText('Submitted')).toBeTruthy();
    expect(screen.getByText('1 Pending')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'View details' })[1]);
    expect(await screen.findByText('I missed the review session.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open subject' })).toHaveAttribute('href', '/dashboard/subjects/sub-1');
    expect(screen.getByRole('button', { name: 'Save reply' })).toBeTruthy();
  });

  it('saves an instructor reply on the engagement feedback row', async () => {
    renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'View details' }))[0]);
    fireEvent.change(screen.getByLabelText('Reply'), {
      target: { value: 'Let us review Activity 1 together.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save reply' }));

    expect(rpc).toHaveBeenCalledWith('instructor_reply_to_feedback', {
      p_kind: 'engagement',
      p_feedback_id: 'eng-1',
      p_response: 'Let us review Activity 1 together.',
    });
    expect(await screen.findByText(/Reviewed/)).toBeTruthy();
    expect(toastSuccess).toHaveBeenCalledWith('Reply saved');
  });
});
