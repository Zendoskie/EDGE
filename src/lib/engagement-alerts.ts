export type EngagementAlertType =
  | 'no_login_3_days'
  | 'no_login_7_days'
  | 'score_drop_20'
  | 'active_to_low'
  | 'low_to_inactive';

export type EngagementAlertStatus = 'open' | 'acknowledged' | 'resolved' | 'dismissed';

export type EngagementInterventionAction =
  | 'send_reminder'
  | 'send_email_reminder'
  | 'schedule_consultation'
  | 'add_note'
  | 'mark_contacted';

export type EngagementAlert = {
  id: string;
  student_id: string;
  alert_type: EngagementAlertType;
  title: string;
  message: string;
  from_level: string | null;
  to_level: string | null;
  from_score: number | null;
  to_score: number | null;
  status: EngagementAlertStatus;
  dedupe_key: string;
  created_at: string;
  updated_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
};

export type EngagementIntervention = {
  id: string;
  alert_id: string | null;
  student_id: string;
  instructor_id: string;
  action_type: EngagementInterventionAction;
  note: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export function engagementAlertTypeLabel(type: string): string {
  switch (type) {
    case 'no_login_3_days':
      return 'No login (3 days)';
    case 'no_login_7_days':
      return 'No login (7 days)';
    case 'score_drop_20':
      return 'Score drop >20%';
    case 'active_to_low':
      return 'Active → Low Engagement';
    case 'low_to_inactive':
      return 'Low Engagement → Inactive';
    default:
      return type.replace(/_/g, ' ');
  }
}

export function engagementInterventionActionLabel(action: string): string {
  switch (action) {
    case 'send_reminder':
      return 'Send Reminder';
    case 'send_email_reminder':
      return 'Send Email Reminder';
    case 'schedule_consultation':
      return 'Schedule Consultation';
    case 'add_note':
      return 'Add Engagement Note';
    case 'mark_contacted':
      return 'Mark Student as Contacted';
    default:
      return action.replace(/_/g, ' ');
  }
}
