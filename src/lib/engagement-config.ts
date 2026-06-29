export const ENGAGEMENT_CONFIG = {
  windowDays: 30,
  inactivityDays: 7,
  noParticipationDays: 7,
  dedupePageViewHours: 24,
  loginTargetPerWeek: 5,
  participationTarget: 20,
  materialViewsTarget: 15,
  thresholds: {
    veryHigh: 80,
    high: 60,
    moderate: 40,
  },
  weights: {
    loginFrequency: 0.25,
    participation: 0.35,
    materialViews: 0.25,
    timelySubmissions: 0.15,
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
  | 'assignment_submit';
