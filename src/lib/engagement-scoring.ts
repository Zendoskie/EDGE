import { ENGAGEMENT_CONFIG } from '@/lib/engagement-config';
import { canonicalEngagementLevel, type CanonicalEngagementLevel } from '@/lib/engagement-utils';

export type EngagementScoreInputs = {
  loginCount: number;
  timeSpentSeconds: number;
  assignmentActivityCount: number;
  aiFeedbackCount: number;
  windowDays?: number;
};

export function computeLoginFrequencyScore(loginCount: number, windowDays: number = ENGAGEMENT_CONFIG.windowDays): number {
  const weeks = Math.max(1, windowDays / 7);
  const loginsPerWeek = loginCount / weeks;
  return Math.min(100, (loginsPerWeek / ENGAGEMENT_CONFIG.loginTargetPerWeek) * 100);
}

export function computeTimeSpentScore(timeSpentSeconds: number, windowDays: number = ENGAGEMENT_CONFIG.windowDays): number {
  const weeks = Math.max(1, windowDays / 7);
  const hoursPerWeek = timeSpentSeconds / 3600 / weeks;
  return Math.min(100, (hoursPerWeek / ENGAGEMENT_CONFIG.timeSpentTargetHoursPerWeek) * 100);
}

export function computeAssignmentActivityScore(assignmentActivityCount: number): number {
  return Math.min(100, (assignmentActivityCount / ENGAGEMENT_CONFIG.assignmentActivityTarget) * 100);
}

export function computeAiFeedbackScore(aiFeedbackCount: number): number {
  return Math.min(100, (aiFeedbackCount / ENGAGEMENT_CONFIG.aiFeedbackTarget) * 100);
}

/** @deprecated Use computeAssignmentActivityScore / computeAiFeedbackScore. */
export function computeParticipationScore(participationCount: number): number {
  return Math.min(100, (participationCount / ENGAGEMENT_CONFIG.participationTarget) * 100);
}

/** @deprecated Use computeAssignmentActivityScore. */
export function computeMaterialViewsScore(materialViewCount: number): number {
  return Math.min(100, (materialViewCount / ENGAGEMENT_CONFIG.materialViewsTarget) * 100);
}

/** @deprecated Timely submissions are no longer a scoring pillar. */
export function computeTimelySubmissionScore(totalSubmissions: number, timelySubmissions: number): number {
  if (totalSubmissions <= 0) return 50;
  return (timelySubmissions / totalSubmissions) * 100;
}

export function computeEngagementScore(inputs: EngagementScoreInputs): number {
  const { weights } = ENGAGEMENT_CONFIG;
  const windowDays = inputs.windowDays ?? ENGAGEMENT_CONFIG.windowDays;
  const loginScore = computeLoginFrequencyScore(inputs.loginCount, windowDays);
  const timeScore = computeTimeSpentScore(inputs.timeSpentSeconds, windowDays);
  const assignmentScore = computeAssignmentActivityScore(inputs.assignmentActivityCount);
  const aiFeedbackScore = computeAiFeedbackScore(inputs.aiFeedbackCount);

  const score =
    loginScore * weights.loginFrequency +
    timeScore * weights.timeSpent +
    assignmentScore * weights.assignmentActivity +
    aiFeedbackScore * weights.aiFeedback;

  return Math.round(score * 10) / 10;
}

export function classifyEngagementScore(score: number | null): CanonicalEngagementLevel {
  if (score == null || !Number.isFinite(score)) return 'moderate';
  const { thresholds } = ENGAGEMENT_CONFIG;
  if (score >= thresholds.veryHigh) return 'very_high';
  if (score >= thresholds.high) return 'high';
  if (score >= thresholds.moderate) return 'moderate';
  return 'low';
}

export function computeEngagementClassification(inputs: EngagementScoreInputs): {
  engagementScore: number;
  engagementLevel: CanonicalEngagementLevel;
} {
  const engagementScore = computeEngagementScore(inputs);
  return {
    engagementScore,
    engagementLevel: classifyEngagementScore(engagementScore),
  };
}

export function isEngagementDrop(
  previous: unknown,
  current: unknown,
): boolean {
  const prev = canonicalEngagementLevel(previous);
  const curr = canonicalEngagementLevel(current);
  const order: CanonicalEngagementLevel[] = ['low', 'moderate', 'high', 'very_high'];
  return order.indexOf(curr) < order.indexOf(prev);
}
