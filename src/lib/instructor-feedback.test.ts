import { describe, expect, it } from 'vitest';
import { countPendingEngagementFeedback } from '@/lib/instructor-feedback';

describe('countPendingEngagementFeedback', () => {
  it('counts submitted feedback and leaves reviewed items out of the pending total', () => {
    expect(
      countPendingEngagementFeedback([
        { status: 'submitted' },
        { status: 'reviewed' },
        { status: 'resolved' },
        { status: null },
      ]),
    ).toBe(2);
  });
});
