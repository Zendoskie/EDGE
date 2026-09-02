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
  | 'mark_contacted'
  | 'guidance_counseling'
  | 'parent_contact'
  | 'provide_learning_materials';

export type EngagementInterventionStatus =
  | 'open'
  | 'follow_up_due'
  | 'completed'
  | 'cancelled';

export type EngagementOutcomeRating = 'improved' | 'no_change' | 'declined';

export type InterventionStaffOutcome = {
  outcome_note: string | null;
  completed_by: string;
};

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
  actor_role: 'instructor' | 'guidance_counselor' | 'admin';
  note: string | null;
  metadata: Record<string, unknown>;
  subject_id: string | null;
  referral_id: string | null;
  status: EngagementInterventionStatus;
  follow_up_due_at: string | null;
  follow_up_notified_at: string | null;
  completed_at: string | null;
  completed_by: string | null;
  baseline_engagement_score: number | null;
  baseline_engagement_level: string | null;
  baseline_risk_score: number | null;
  baseline_risk_level: string | null;
  baseline_assignments_submitted: number | null;
  baseline_login_count: number | null;
  outcome_engagement_score: number | null;
  outcome_engagement_level: string | null;
  outcome_risk_score: number | null;
  outcome_risk_level: string | null;
  outcome_assignments_submitted: number | null;
  outcome_login_count: number | null;
  engagement_score_delta: number | null;
  risk_score_delta: number | null;
  assignments_submitted_delta: number | null;
  login_count_delta: number | null;
  outcome_rating: EngagementOutcomeRating | null;
  intervention_staff_outcomes?: InterventionStaffOutcome[] | InterventionStaffOutcome | null;
  created_at: string;
  updated_at: string;
};

export function isInterventionFollowUpDue(
  intervention: Pick<EngagementIntervention, 'status' | 'follow_up_due_at'>,
  now = new Date(),
): boolean {
  if (
    intervention.status === 'completed' ||
    intervention.status === 'cancelled' ||
    !intervention.follow_up_due_at
  ) {
    return false;
  }
  const dueAt = Date.parse(intervention.follow_up_due_at);
  return Number.isFinite(dueAt) && dueAt <= now.getTime();
}

export function interventionStatusLabel(status: string): string {
  switch (status) {
    case 'open':
      return 'Follow-up scheduled';
    case 'follow_up_due':
      return 'Follow-up due';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status.replace(/_/g, ' ');
  }
}

export function engagementOutcomeLabel(outcome: string | null): string {
  switch (outcome) {
    case 'improved':
      return 'Improved';
    case 'no_change':
      return 'No meaningful change';
    case 'declined':
      return 'Declined';
    default:
      return 'Not evaluated';
  }
}

export function formatSignedDelta(value: number | null, suffix = ''): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}${suffix}`;
}

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

export function engagementActorRoleLabel(role: string | null | undefined): string {
  switch (role) {
    case 'guidance_counselor':
      return 'Guidance Counselor';
    case 'admin':
      return 'Administrator';
    default:
      return 'Instructor';
  }
}

export function formatEngagementFollowUpNotice(opts: {
  actorRole?: string | null;
  actorName: string;
  studentName: string;
  completed?: boolean;
}): string {
  const role = engagementActorRoleLabel(opts.actorRole);
  const actor = opts.actorName.trim() || 'Staff';
  const student = opts.studentName.trim() || 'the student';
  if (opts.completed) {
    return `${role} ${actor} completed an engagement follow-up for ${student}.`;
  }
  return `${role} ${actor} sent an engagement follow-up for ${student}.`;
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
    case 'guidance_counseling':
      return 'Guidance Counseling';
    case 'parent_contact':
      return 'Contact Parent';
    case 'provide_learning_materials':
      return 'Provide Learning Materials';
    default:
      return action.replace(/_/g, ' ');
  }
}
