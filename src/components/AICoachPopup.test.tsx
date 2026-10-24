import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AICoachPopup, canSendCoachMessage, toApiMessages } from '@/components/AICoachPopup';
import { invokeAiCoach } from '@/lib/invoke-ai-coach';
import { markCoachClosedThisSession } from '@/lib/ai-coach-proactive';

vi.mock('@/lib/invoke-ai-coach', () => ({
  invokeAiCoach: vi.fn(),
}));

vi.mock('@/lib/track-activity', () => ({
  trackStudentActivity: vi.fn(),
}));

const baseMetrics = {
  subjectId: 'sub-1',
  subjectCode: 'CS101',
  subjectName: 'Intro to CS',
  riskClassification: 'at_risk' as const,
  riskScore: 72,
  riskEvidence: null,
  attendancePercent: 80,
  activityScorePercent: 65,
  quizScorePercent: 70,
  laboratoryExamPercent: null,
  comprehensionRating: null,
  systemRecommendation: 'Review weekly',
  createdAt: new Date().toISOString(),
};

function renderCoach(overrides: Partial<Parameters<typeof AICoachPopup>[0]> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AICoachPopup
        userId="student-1"
        riskLevel="at_risk"
        subjectLabel="CS101"
        atRiskMetrics={[baseMetrics]}
        metrics={baseMetrics}
        {...overrides}
      />
    </QueryClientProvider>,
  );
}

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
    sessionStorage.clear();
    document.body.innerHTML = '<div id="ai-coach-header-slot"></div>';
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(invokeAiCoach).mockReset();
    vi.mocked(invokeAiCoach).mockResolvedValue({ reply: 'Your 7-day study plan starts with weak quiz review.' });
  });

  it('renders for at-risk students without crashing', () => {
    renderCoach();
    expect(screen.getByLabelText('AI Coach')).toBeInTheDocument();
  });

  it('auto-opens for at-risk students when the session is not dismissed', async () => {
    renderCoach();
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  });

  it('does not auto-open when the student closed the coach this session', async () => {
    markCoachClosedThisSession('student-1');
    renderCoach();
    await waitFor(() => expect(invokeAiCoach).not.toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('fetches proactive study plan without user typing', async () => {
    renderCoach();
    await waitFor(() => expect(invokeAiCoach).toHaveBeenCalled());
    const body = vi.mocked(invokeAiCoach).mock.calls[0][0] as { messages: { role: string; content: string }[] };
    expect(body.messages[0].content).toMatch(/EDGE_PROACTIVE_AT_RISK_BRIEFING/);
    await waitFor(() =>
      expect(screen.getByText('Your 7-day study plan starts with weak quiz review.')).toBeInTheDocument(),
    );
  });

  it('blocks a second send while the first request is running, then accepts the same question after it finishes', async () => {
    const invoke = vi.mocked(invokeAiCoach);
    let release: (value: { reply: string }) => void = () => {};
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    invoke.mockResolvedValue({ reply: 'Study Plan B' });

    renderCoach();

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    release({ reply: 'Proactive plan' });
    await waitFor(() => expect(screen.getByText('Proactive plan')).toBeInTheDocument());

    const box = await screen.findByPlaceholderText('Type your message…');
    fireEvent.change(box, { target: { value: 'Recommend a study plan' } });
    const send = screen.getByRole('button', { name: 'Send message' });
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(invoke.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
