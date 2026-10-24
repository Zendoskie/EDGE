import { describe, expect, it } from 'vitest';
import {
  canonicalRiskBandLabel,
  parentAttendanceUpdateLogId,
  parentReferralUpdateLogId,
  parentRiskTransitionLogId,
  shouldNotifyParentRiskTransition,
} from '../../supabase/functions/_shared/notification-channels';

describe('linked parent notification helpers', () => {
  it('only notifies parents when risk band actually changes', () => {
    expect(shouldNotifyParentRiskTransition('stable', 'at_risk')).toBe(true);
    expect(shouldNotifyParentRiskTransition('excelling', 'excelling')).toBe(false);
    expect(shouldNotifyParentRiskTransition(null, 'critical')).toBe(false);
    expect(shouldNotifyParentRiskTransition('stable', null)).toBe(false);
  });

  it('maps canonical risk bands to parent-facing labels', () => {
    expect(canonicalRiskBandLabel('at_risk')).toBe('Vulnerable');
    expect(canonicalRiskBandLabel('critical')).toBe('Crucial');
    expect(canonicalRiskBandLabel('stable')).toBe('Stable');
    expect(canonicalRiskBandLabel('excelling')).toBe('Excelling');
  });

  it('builds stable dedupe keys per parent and event', () => {
    expect(parentAttendanceUpdateLogId('parent-1', 'attendance_update:abc:present:r1')).toBe(
      'parent-1:attendance_update:abc:present:r1',
    );
    expect(
      parentRiskTransitionLogId('parent-1', 'pred-1', 'stable', 'at_risk', '2026-10-21T00:00:00Z'),
    ).toBe('parent-1:pred-1:stable->at_risk:2026-10-21T00:00:00Z');
    expect(parentReferralUpdateLogId('parent-1', 'ref-1', 'referral_created')).toBe(
      'parent-1:ref-1:referral_created',
    );
  });

  it('isolates dedupe keys per parent so unrelated parents do not share logs', () => {
    const studentEvent = 'attendance_update:att-9:present:r1';
    expect(parentAttendanceUpdateLogId('parent-a', studentEvent)).not.toBe(
      parentAttendanceUpdateLogId('parent-b', studentEvent),
    );
  });
});
