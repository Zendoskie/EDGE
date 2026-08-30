import { describe, expect, it } from 'vitest';
import {
  engagementOutcomeLabel,
  engagementAlertTypeLabel,
  engagementInterventionActionLabel,
  formatSignedDelta,
  interventionStatusLabel,
  isInterventionFollowUpDue,
} from '@/lib/engagement-alerts';

describe('engagement-alerts labels', () => {
  it('maps alert types to display labels', () => {
    expect(engagementAlertTypeLabel('no_login_3_days')).toBe('No login (3 days)');
    expect(engagementAlertTypeLabel('no_login_7_days')).toBe('No login (7 days)');
    expect(engagementAlertTypeLabel('score_drop_20')).toBe('Score drop >20%');
    expect(engagementAlertTypeLabel('active_to_low')).toBe('Active → Low Engagement');
    expect(engagementAlertTypeLabel('low_to_inactive')).toBe('Low Engagement → Inactive');
  });

  it('maps intervention actions to display labels', () => {
    expect(engagementInterventionActionLabel('send_reminder')).toBe('Send Reminder');
    expect(engagementInterventionActionLabel('send_email_reminder')).toBe('Send Email Reminder');
    expect(engagementInterventionActionLabel('schedule_consultation')).toBe('Schedule Consultation');
    expect(engagementInterventionActionLabel('add_note')).toBe('Add Engagement Note');
    expect(engagementInterventionActionLabel('mark_contacted')).toBe('Mark Student as Contacted');
    expect(engagementInterventionActionLabel('guidance_counseling')).toBe('Guidance Counseling');
    expect(engagementInterventionActionLabel('parent_contact')).toBe('Contact Parent');
    expect(engagementInterventionActionLabel('provide_learning_materials')).toBe(
      'Provide Learning Materials',
    );
  });
});

describe('closed-loop intervention helpers', () => {
  it('detects overdue follow-ups without treating closed records as due', () => {
    const now = new Date('2026-08-30T12:00:00.000Z');
    expect(
      isInterventionFollowUpDue(
        { status: 'open', follow_up_due_at: '2026-08-29T12:00:00.000Z' },
        now,
      ),
    ).toBe(true);
    expect(
      isInterventionFollowUpDue(
        { status: 'completed', follow_up_due_at: '2026-08-29T12:00:00.000Z' },
        now,
      ),
    ).toBe(false);
  });

  it('formats lifecycle, outcome, and measured deltas', () => {
    expect(interventionStatusLabel('follow_up_due')).toBe('Follow-up due');
    expect(engagementOutcomeLabel('no_change')).toBe('No meaningful change');
    expect(formatSignedDelta(8.25, ' pts')).toBe('+8.3 pts');
    expect(formatSignedDelta(-4)).toBe('-4');
    expect(formatSignedDelta(null)).toBe('—');
  });
});
