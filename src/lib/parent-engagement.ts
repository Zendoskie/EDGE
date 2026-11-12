/**
 * Parent check-in engagement.
 *
 * This is how often a linked parent reviews the student's EDGE account. It is a
 * separate measure from the student's engagement score and never affects grades.
 */

export const PARENT_ENGAGEMENT_CONFIG = {
  /** Rolling window used for the score. */
  windowDays: 30,
  /** Check-ins per week that earn a full score (about twice a week). */
  targetCheckInsPerWeek: 2,
  /** Repeat views inside this many minutes are one check-in (also enforced in SQL). */
  dedupeMinutes: 30,
} as const;

export type ParentEngagementLevel = 'very_high' | 'high' | 'moderate' | 'low';

/** 0-100 score: average check-ins per week over the rolling window. */
export function computeParentEngagementScore(
  checkInCount: number,
  windowDays: number = PARENT_ENGAGEMENT_CONFIG.windowDays,
): number {
  const count = Number.isFinite(checkInCount) ? Math.max(0, checkInCount) : 0;
  const weeks = Math.max(1, windowDays / 7);
  const checkInsPerWeek = count / weeks;
  const score = Math.min(
    100,
    (checkInsPerWeek / PARENT_ENGAGEMENT_CONFIG.targetCheckInsPerWeek) * 100,
  );
  return Math.round(score * 10) / 10;
}

export function classifyParentEngagementScore(score: number | null): ParentEngagementLevel {
  if (score == null || !Number.isFinite(score)) return 'moderate';
  if (score >= 80) return 'very_high';
  if (score >= 60) return 'high';
  if (score >= 40) return 'moderate';
  return 'low';
}

/** Number of check-ins inside the rolling window ending at `now`. */
export function countCheckInsInWindow(
  timestamps: Array<string | null | undefined>,
  now: Date = new Date(),
  windowDays: number = PARENT_ENGAGEMENT_CONFIG.windowDays,
): number {
  const windowStartMs = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  let count = 0;
  for (const value of timestamps) {
    if (!value) continue;
    const at = Date.parse(value);
    if (!Number.isFinite(at)) continue;
    if (at < windowStartMs || at > now.getTime()) continue;
    count += 1;
  }
  return count;
}

export function latestCheckIn(timestamps: Array<string | null | undefined>): string | null {
  let latest: number | null = null;
  let latestIso: string | null = null;
  for (const value of timestamps) {
    if (!value) continue;
    const at = Date.parse(value);
    if (!Number.isFinite(at)) continue;
    if (latest == null || at > latest) {
      latest = at;
      latestIso = value;
    }
  }
  return latestIso;
}

export type ParentEngagementSummary = {
  checkInCount: number;
  score: number;
  level: ParentEngagementLevel;
  lastCheckInAt: string | null;
  windowDays: number;
  targetCheckInsPerWeek: number;
};

export function summarizeParentEngagement(
  timestamps: Array<string | null | undefined>,
  now: Date = new Date(),
): ParentEngagementSummary {
  const checkInCount = countCheckInsInWindow(timestamps, now);
  const score = computeParentEngagementScore(checkInCount);
  return {
    checkInCount,
    score,
    level: classifyParentEngagementScore(score),
    lastCheckInAt: latestCheckIn(timestamps),
    windowDays: PARENT_ENGAGEMENT_CONFIG.windowDays,
    targetCheckInsPerWeek: PARENT_ENGAGEMENT_CONFIG.targetCheckInsPerWeek,
  };
}

export type ParentCheckInRow = {
  parent_user_id: string;
  viewed_at: string;
};

/**
 * Instructor view: every linked parent has their own score. Report the most
 * active parent so one engaged guardian is not diluted by an inactive one.
 */
export function summarizeParentEngagementByParent(
  rows: ParentCheckInRow[],
  now: Date = new Date(),
): { parentCount: number; best: ParentEngagementSummary } {
  const byParent = new Map<string, Array<string | null | undefined>>();
  for (const row of rows) {
    if (!row?.parent_user_id) continue;
    const list = byParent.get(row.parent_user_id) ?? [];
    list.push(row.viewed_at);
    byParent.set(row.parent_user_id, list);
  }

  let best: ParentEngagementSummary = summarizeParentEngagement([], now);
  for (const timestamps of byParent.values()) {
    const summary = summarizeParentEngagement(timestamps, now);
    if (
      summary.score > best.score ||
      (summary.score === best.score && summary.checkInCount > best.checkInCount)
    ) {
      best = summary;
    }
  }

  return { parentCount: byParent.size, best };
}
