import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EngagementTimeSpentCard } from '@/components/EngagementTimeSpentCard';

vi.mock('@/hooks/useStudentTimeSpent', () => ({
  useStudentTimeSpent: () => ({
    timeSpent: {
      today: 240,
      yesterday: 600,
      week: 1800,
      month: 3600,
      total: 7200,
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

describe('EngagementTimeSpentCard', () => {
  it('shows the selected period value', () => {
    render(<EngagementTimeSpentCard studentId="student-1" defaultPeriod="week" />);
    expect(screen.getByText('30 Minutes')).toBeInTheDocument();
    expect(screen.getByText(/This week so far/)).toBeInTheDocument();
  });

  it('shows today by default', () => {
    render(<EngagementTimeSpentCard studentId="student-1" />);
    expect(screen.getByText('4 Minutes')).toBeInTheDocument();
    expect(screen.getByText(/idle or hidden tab time is not counted/i)).toBeInTheDocument();
  });
});
