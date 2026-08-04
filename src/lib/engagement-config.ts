export const ENGAGEMENT_CONFIG = {
  windowDays: 30,
  inactivityDays: 7,
  noParticipationDays: 7,
  dedupePageViewHours: 24,
  /** Target logins per week for a full login-frequency score. */
  loginTargetPerWeek: 5,
  /** Target hours online per week for a full time-spent score. */
  timeSpentTargetHoursPerWeek: 5,
  /** Target assignment view/submit events in the scoring window. */
  assignmentActivityTarget: 10,
  /** Target AI coaching + feedback events in the scoring window. */
  aiFeedbackTarget: 5,
  /** @deprecated Kept for older helpers; scoring uses assignment/AI targets. */
  participationTarget: 20,
  /** @deprecated Kept for older helpers; scoring uses assignment activity. */
  materialViewsTarget: 15,
  thresholds: {
    veryHigh: 80,
    high: 60,
    moderate: 40,
  },
  weights: {
    loginFrequency: 0.4,
    timeSpent: 0.3,
    assignmentActivity: 0.2,
    aiFeedback: 0.1,
  },
} as const;

export type EngagementActivityType =
  | 'view_material'
  | 'open_module'
  | 'read_announcement'
  | 'view_file'
  | 'view_subject_page'
  | 'view_coaching'
  | 'view_grades'
  | 'view_attendance'
  | 'quiz_complete'
  | 'assignment_submit'
  | 'assignment_view'
  | 'ai_session'
  | 'feedback_submit'
  | 'page_visit';
