import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RiskBadge } from '@/components/RiskBadge';
import { formatOfficialRiskLabel } from '@/lib/risk-scoring';

const completeEvidence = {
  activity_average: 80,
  quiz_average: 80,
  project_score: 80,
  attendance_rate: 0.9,
  laboratory_exam_average: 80,
  midterm_exam_average: null,
  final_exam_average: null,
};

describe('RiskBadge', () => {
  it('uses the official label and shows the score only on a matching band', () => {
    const cases: Array<{ level: string; score: number; text: string }> = [
      { level: 'stable', score: 20, text: 'Stable' },
      { level: 'critical', score: 20, text: 'Crucial (20.00)' },
      { level: 'critical', score: 79, text: 'Crucial' },
      { level: 'at_risk', score: 76.5, text: 'Vulnerable (76.50)' },
      { level: 'stable', score: 89.6, text: 'Stable (89.60)' },
      { level: 'excelling', score: 89.995, text: 'Excelling (90.00)' },
      // Held by the coverage guard: the band score is not shown beside a different label.
      { level: 'stable', score: 92, text: 'Stable' },
      { level: 'at_risk', score: 40, text: 'Vulnerable' },
    ];

    for (const { level, score, text } of cases) {
      expect(formatOfficialRiskLabel(level, score)).toBe(text);
      const { unmount } = render(<RiskBadge level={level} evidence={{ ...completeEvidence, risk_score: score }} />);
      expect(screen.getByText(text)).toBeInTheDocument();
      unmount();
    }
  });

  it('shows Insufficient data, a provisional qualifier or unverified instead of a bare label', () => {
    const { rerender } = render(<RiskBadge level="stable" evidence={{ ...completeEvidence, risk_score: null }} />);
    expect(screen.getByText('Insufficient data')).toBeInTheDocument();

    rerender(
      <RiskBadge
        level="at_risk"
        evidence={{ ...completeEvidence, project_score: null, risk_score: 70 }}
        weights={null}
      />,
    );
    expect(screen.getByText('Vulnerable — Provisional (incomplete data)')).toBeInTheDocument();

    rerender(<RiskBadge level="critical" />);
    expect(screen.getByText('Crucial — Risk status unverified')).toBeInTheDocument();
  });
});
