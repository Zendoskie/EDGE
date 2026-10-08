import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AICoachPopup, canSendCoachMessage, toApiMessages } from '@/components/AICoachPopup';
import { invokeAiCoach } from '@/lib/invoke-ai-coach';

vi.mock('@/lib/invoke-ai-coach', () => ({
  invokeAiCoach: vi.fn(),
}));

vi.mock('@/lib/track-activity', () => ({
  trackStudentActivity: vi.fn(),
}));

describe('AI Coach request payload', () => {
  it('sends only real conversation turns: no starter, no client-built context, no student id', () => {
    const payload = toApiMessages(
      [
        { role: 'assistant', content: 'Hi—I loaded your risk analysis. Risk: Excelling' },
        { role: 'user', content: 'What is my Quiz 1 score in PL101?' },
        { role: 'assistant', content: 'You scored 82%.' },
      ],
      'How can I improve?',
    );
    expect(payload).toEqual([
      { role: 'user', content: 'What is my Quiz 1 score in PL101?' },
      { role: 'assistant', content: 'You scored 82%.' },
      { role: 'user', content: 'How can I improve?' },
    ]);
    expect(JSON.stringify(payload)).not.toMatch(/Context \(do not quote|student_id/i);
  });

  it('sends the same question again after the previous reply is already in the thread', () => {
    const payload = toApiMessages(
      [
        { role: 'assistant', content: 'Hi—I loaded your risk analysis.' },
        { role: 'user', content: 'Recommend a study plan' },
        { role: 'assistant', content: 'Study Plan A' },
      ],
      'Recommend a study plan',
    );
    expect(payload).toEqual([
      { role: 'user', content: 'Recommend a study plan' },
      { role: 'assistant', content: 'Study Plan A' },
      { role: 'user', content: 'Recommend a study plan' },
    ]);
  });

  it('allows a completed question and blocks one that is still in flight', () => {
    expect(canSendCoachMessage('Recommend a study plan', false)).toBe(true);
    expect(canSendCoachMessage('Recommend a study plan', true)).toBe(false);
    expect(canSendCoachMessage('   ', false)).toBe(false);
  });
});

describe('AICoachPopup', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="ai-coach-header-slot"></div>';
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('renders for at-risk students without crashing', () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AICoachPopup
          riskLevel="at_risk"
          subjectLabel="CS101"
          metrics={{
            subjectId: 'sub-1',
            subjectCode: 'CS101',
            subjectName: 'Intro to CS',
            riskClassification: 'at_risk',
            riskScore: 72,
            attendancePercent: 80,
            activityScorePercent: 65,
            quizScorePercent: 70,
            laboratoryExamPercent: null,
            comprehensionRating: null,
            systemRecommendation: 'Review weekly',
            createdAt: new Date().toISOString(),
          }}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText('AI Coach')).toBeInTheDocument();
  });

  it('blocks a second send while the first request is running, then accepts the same question after it finishes', async () => {
    const invoke = vi.mocked(invokeAiCoach);
    let release: (value: { reply: string }) => void = () => {};
    invoke.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = resolve;
      }),
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AICoachPopup
          riskLevel="at_risk"
          subjectLabel="CS101"
          metrics={{
            subjectId: 'sub-1',
            subjectCode: 'CS101',
            subjectName: 'Intro to CS',
            riskClassification: 'at_risk',
            riskScore: 72,
            attendancePercent: 80,
            activityScorePercent: 65,
            quizScorePercent: 70,
            laboratoryExamPercent: null,
            comprehensionRating: null,
            systemRecommendation: 'Review weekly',
            createdAt: new Date().toISOString(),
          }}
        />
      </QueryClientProvider>,
    );

    const box = await screen.findByPlaceholderText('Type your message…');
    fireEvent.change(box, { target: { value: 'Recommend a study plan' } });
    const send = screen.getByRole('button', { name: 'Send message' });
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();

    release({ reply: 'Study Plan A' });
    await waitFor(() => expect(screen.getByText('Study Plan A')).toBeInTheDocument());

    invoke.mockResolvedValueOnce({ reply: 'Study Plan B' });
    fireEvent.change(screen.getByPlaceholderText('Type your message…'), {
      target: { value: 'Recommend a study plan' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    const secondBody = invoke.mock.calls[1][0] as { messages: { role: string; content: string }[] };
    expect(secondBody.messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual([
      'Recommend a study plan',
      'Recommend a study plan',
    ]);
    await waitFor(() => expect(screen.getByText('Study Plan B')).toBeInTheDocument());
  });
});
