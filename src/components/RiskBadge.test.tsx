import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RiskBadge } from '@/components/RiskBadge';
import { formatOfficialRiskLabel } from '@/lib/risk-scoring';

describe('RiskBadge', () => {
  it('uses the official label and shows the score only on a matching band', () => {
    const cases: Array<{ level: string; score: number; text: string }> = [
      { level: 'stable', score: 20, text: 'Stable' },
      { level: 'critical', score: 20, text: 'Crucial (20)' },
      { level: 'critical', score: 79, text: 'Crucial' },
      { level: 'at_risk', score: 66.7, text: 'Vulnerable (66.7)' },
    ];

    for (const { level, score, text } of cases) {
      expect(formatOfficialRiskLabel(level, score)).toBe(text);
      const { unmount } = render(<RiskBadge level={level} score={score} />);
      expect(screen.getByText(text)).toBeInTheDocument();
      unmount();
    }
  });
});
