import { ENGAGEMENT_CONFIG } from '@/lib/engagement-config';
import { PARENT_ENGAGEMENT_CONFIG } from '@/lib/parent-engagement';

export type EngagementPillar = {
  key: string;
  label: string;
  weightPercent: number;
  target: string;
  detail: string;
};

export type EngagementLevelBand = {
  label: string;
  minimum: number;
  description: string;
};

export type EngagementExplanation = {
  title: string;
  summary: string;
  windowDays: number;
  pillars: EngagementPillar[];
  levels: EngagementLevelBand[];
  notes: string[];
};

/**
 * In-app explanation of the student engagement score.
 * Keep the weights and targets tied to ENGAGEMENT_CONFIG so the copy cannot
 * drift from the computation.
 */
export function studentEngagementExplanation(): EngagementExplanation {
  const { weights, thresholds, windowDays } = ENGAGEMENT_CONFIG;

  return {
    title: 'How the engagement score is computed',
    summary:
      'The engagement score is a 0–100 grade for how actively a student uses EDGE. ' +
      'It combines four signals over a rolling window. It is a participation measure, not an academic grade.',
    windowDays,
    pillars: [
      {
        key: 'loginFrequency',
        label: 'Login frequency',
        weightPercent: Math.round(weights.loginFrequency * 100),
        target: `${ENGAGEMENT_CONFIG.loginTargetPerWeek} counted logins per week`,
        detail:
          'One login is recorded per sign-in. Restored sessions, page reloads, and returning visits do not add another login.',
      },
      {
        key: 'timeSpent',
        label: 'Active time',
        weightPercent: Math.round(weights.timeSpent * 100),
        target: `${ENGAGEMENT_CONFIG.timeSpentTargetHoursPerWeek} hours of active time per week`,
        detail:
          'Time is credited from heartbeats only while the EDGE tab is visible and the student is interacting. ' +
          'Idle time and hidden tabs are not counted, so leaving the page open does not raise the score.',
      },
      {
        key: 'assignmentActivity',
        label: 'Assignment activity',
        weightPercent: Math.round(weights.assignmentActivity * 100),
        target: `${ENGAGEMENT_CONFIG.assignmentActivityTarget} assignment or quiz events in the window`,
        detail:
          'Counts assignment views, submissions, and completed quizzes recorded in the window.',
      },
      {
        key: 'aiFeedback',
        label: 'AI coaching and feedback',
        weightPercent: Math.round(weights.aiFeedback * 100),
        target: `${ENGAGEMENT_CONFIG.aiFeedbackTarget} AI coaching or feedback events in the window`,
        detail:
          'Counts AI coaching sessions, coaching views, and feedback the student submits.',
      },
    ],
    levels: [
      {
        label: 'Highly Active',
        minimum: thresholds.veryHigh,
        description: 'Very consistent logins, study time, and coursework activity.',
      },
      {
        label: 'Active',
        minimum: thresholds.high,
        description: 'Regular participation across most signals.',
      },
      {
        label: 'Low Engagement',
        minimum: thresholds.moderate,
        description: 'Some participation, but several signals are below target.',
      },
      {
        label: 'Inactive',
        minimum: 0,
        description: 'Little recorded activity in the window.',
      },
    ],
    notes: [
      'Each signal is scored from 0 to 100 and capped at 100 before weighting. The weighted total is capped at 100.',
      `The window is the last ${windowDays} days, recalculated when logins, activity, submissions, AI sessions, or feedback change.`,
      'Sessions recorded before active-time tracking used wall-clock time and are not carried forward. Measured time starts when beat tracking begins.',
    ],
  };
}

/**
 * In-app explanation of the parent check-in engagement score.
 */
export function parentEngagementExplanation(): EngagementExplanation {
  const { windowDays, targetCheckInsPerWeek, dedupeMinutes } = PARENT_ENGAGEMENT_CONFIG;

  return {
    title: 'How parent check-in engagement is computed',
    summary:
      'Parent check-in engagement is a 0–100 grade for how often you review your child’s account in EDGE. ' +
      'It is separate from the student engagement score and does not affect academic grades.',
    windowDays,
    pillars: [
      {
        key: 'checkIns',
        label: 'Account check-ins',
        weightPercent: 100,
        target: `${targetCheckInsPerWeek} check-ins per week`,
        detail:
          'Each visit to your child’s performance page that opens a new check-in counts once. ' +
          `Refreshing or reopening the page within ${dedupeMinutes} minutes counts as the same check-in.`,
      },
    ],
    levels: [
      {
        label: 'Highly Active',
        minimum: 80,
        description: 'You review your child’s account very consistently.',
      },
      {
        label: 'Active',
        minimum: 60,
        description: 'You check in regularly.',
      },
      {
        label: 'Low Engagement',
        minimum: 40,
        description: 'Check-ins are occasional; more frequent reviews would help.',
      },
      {
        label: 'Inactive',
        minimum: 0,
        description: 'Few or no check-ins in the window.',
      },
    ],
    notes: [
      `The score uses the last ${windowDays} days of check-ins and is recalculated as you visit.`,
      'A perfect week of check-ins (the target) earns 100 for that week; the score is capped at 100 overall.',
      'This measure is informational and is never used as a student grade.',
    ],
  };
}
