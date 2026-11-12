import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { EngagementScoreInfo } from '@/components/EngagementScoreInfo';

describe('EngagementScoreInfo', () => {
  it('explains the student formula with weights and window', async () => {
    render(<EngagementScoreInfo variant="student" />);

    fireEvent.click(screen.getByRole('button', { name: /how the engagement score is computed/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText(/Login frequency/i).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/Active time/i).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/40% of score/i)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/idle|hidden/i).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/Rolling window: the last 30 days/i)).toBeInTheDocument();
  });

  it('explains parent check-in engagement separately', async () => {
    render(<EngagementScoreInfo variant="parent" />);

    fireEvent.click(
      screen.getByRole('button', { name: /how parent check-in engagement is computed/i }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/separate from the student engagement score/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Account check-ins/i)).toBeInTheDocument();
  });
});
