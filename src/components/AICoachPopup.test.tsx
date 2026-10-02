import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AICoachPopup, toApiMessages } from '@/components/AICoachPopup';

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
});

describe('AICoachPopup', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="ai-coach-header-slot"></div>';
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
});
