import { describe, expect, it } from 'vitest';
import {
  engagementAlertTypeLabel,
  engagementInterventionActionLabel,
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
  });
});
