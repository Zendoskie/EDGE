import { ENGAGEMENT_CONFIG } from '@/lib/engagement-config';
import { computeEngagementScore } from '@/lib/engagement-scoring';

export type TrendGranularity = 'week' | 'month';

export type LoginEvent = {
  login_time: string;
  logout_time?: string | null;
  session_duration?: number | null;
  counts_as_login?: boolean | null;
};

export type ActivityEvent = {
  created_at: string | null;
  activity_type: string;
};

export type FeedbackEvent = {
  created_at: string;
};

export type RiskEvent = {
  created_at: string | null;
  risk_score: number | null;
};

export type EngagementTrendPoint = {
  /** ISO date for the period end (UTC day). */
  periodEnd: string;
  /** Short axis label. */
  label: string;
  engagementScore: number;
  riskScore: number | null;
};

const ASSIGNMENT_TYPES = new Set(['assignment_view', 'assignment_submit', 'quiz_complete']);
const AI_TYPES = new Set(['ai_session', 'view_coaching']);

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addUtcDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Sunday 00:00 UTC of the week containing `d`. */
function startOfUtcWeek(d: Date): Date {
  const day = startOfUtcDay(d);
  const dow = day.getUTCDay(); // 0=Sun
  return addUtcDays(day, -dow);
}

function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function endOfPeriod(start: Date, granularity: TrendGranularity): Date {
  if (granularity === 'week') {
    return addUtcDays(start, 7);
  }
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
}

function formatPeriodLabel(periodStart: Date, granularity: TrendGranularity): string {
  if (granularity === 'month') {
    return periodStart.toLocaleString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });
  }
  return periodStart.toLocaleString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sessionSecondsAt(login: LoginEvent, asOfMs: number): number {
  const start = Date.parse(login.login_time);
  if (!Number.isFinite(start) || start > asOfMs) return 0;

  if (login.logout_time) {
    const end = Date.parse(login.logout_time);
    if (!Number.isFinite(end)) return 0;
    const cappedEnd = Math.min(end, asOfMs);
    if (cappedEnd < start) return 0;
    if (login.session_duration != null && end <= asOfMs) {
      return Math.max(0, login.session_duration);
    }
    return Math.max(0, Math.round((cappedEnd - start) / 1000));
  }

  if (login.session_duration != null && Number.isFinite(login.session_duration)) {
    const claimedEnd = start + login.session_duration * 1000;
    if (claimedEnd <= asOfMs) return Math.max(0, login.session_duration);
  }

  return Math.max(0, Math.round((asOfMs - start) / 1000));
}

function computeScoreAsOf(
  asOf: Date,
  logins: LoginEvent[],
  activities: ActivityEvent[],
  feedback: FeedbackEvent[],
): number {
  const asOfMs = asOf.getTime();
  const windowStartMs = asOfMs - ENGAGEMENT_CONFIG.windowDays * 24 * 60 * 60 * 1000;

  let loginCount = 0;
  let timeSpentSeconds = 0;
  for (const login of logins) {
    const loginMs = Date.parse(login.login_time);
    if (!Number.isFinite(loginMs) || loginMs > asOfMs) continue;
    if (loginMs >= windowStartMs && login.counts_as_login !== false) {
      loginCount += 1;
    }
    if (loginMs >= windowStartMs) {
      timeSpentSeconds += sessionSecondsAt(login, asOfMs);
    }
  }

  let assignmentActivityCount = 0;
  let aiCount = 0;
  for (const activity of activities) {
    if (!activity.created_at) continue;
    const t = Date.parse(activity.created_at);
    if (!Number.isFinite(t) || t < windowStartMs || t > asOfMs) continue;
    if (ASSIGNMENT_TYPES.has(activity.activity_type)) assignmentActivityCount += 1;
    if (AI_TYPES.has(activity.activity_type)) aiCount += 1;
  }

  let feedbackCount = 0;
  for (const item of feedback) {
    const t = Date.parse(item.created_at);
    if (!Number.isFinite(t) || t < windowStartMs || t > asOfMs) continue;
    feedbackCount += 1;
  }

  return computeEngagementScore({
    loginCount,
    timeSpentSeconds,
    assignmentActivityCount,
    aiFeedbackCount: aiCount + feedbackCount,
    windowDays: ENGAGEMENT_CONFIG.windowDays,
  });
}

function latestRiskAsOf(asOf: Date, risks: RiskEvent[]): number | null {
  const asOfMs = asOf.getTime();
  let best: { at: number; score: number } | null = null;
  for (const risk of risks) {
    if (risk.created_at == null || risk.risk_score == null) continue;
    const t = Date.parse(risk.created_at);
    const score = Number(risk.risk_score);
    if (!Number.isFinite(t) || t > asOfMs || !Number.isFinite(score)) continue;
    if (!best || t >= best.at) best = { at: t, score };
  }
  return best ? Math.round(best.score * 10) / 10 : null;
}

function earliestTimestamp(
  logins: LoginEvent[],
  activities: ActivityEvent[],
  feedback: FeedbackEvent[],
  risks: RiskEvent[],
): number | null {
  let min: number | null = null;
  const consider = (iso: string | null | undefined) => {
    if (!iso) return;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return;
    if (min == null || t < min) min = t;
  };
  for (const l of logins) consider(l.login_time);
  for (const a of activities) consider(a.created_at);
  for (const f of feedback) consider(f.created_at);
  for (const r of risks) consider(r.created_at);
  return min;
}

/**
 * Build engagement (and aligned risk) trend points for every week/month
 * from the earliest recorded event through now. Supports unlimited history.
 */
export function buildEngagementTrendSeries(input: {
  logins: LoginEvent[];
  activities: ActivityEvent[];
  feedback: FeedbackEvent[];
  risks: RiskEvent[];
  granularity?: TrendGranularity;
  now?: Date;
}): EngagementTrendPoint[] {
  const granularity = input.granularity ?? 'week';
  const now = input.now ?? new Date();
  const nowEnd = granularity === 'week' ? addUtcDays(startOfUtcWeek(now), 7) : endOfPeriod(startOfUtcMonth(now), 'month');

  const earliest = earliestTimestamp(input.logins, input.activities, input.feedback, input.risks);
  if (earliest == null) {
    // Still show current period with zeros so charts render.
    const start = granularity === 'week' ? startOfUtcWeek(now) : startOfUtcMonth(now);
    return [
      {
        periodEnd: toIsoDay(nowEnd),
        label: formatPeriodLabel(start, granularity),
        engagementScore: 0,
        riskScore: null,
      },
    ];
  }

  let cursor =
    granularity === 'week' ? startOfUtcWeek(new Date(earliest)) : startOfUtcMonth(new Date(earliest));

  const points: EngagementTrendPoint[] = [];
  // Safety cap: ~20 years of weeks
  const maxPoints = granularity === 'week' ? 1100 : 240;
  let count = 0;

  while (cursor < nowEnd && count < maxPoints) {
    const periodEnd = endOfPeriod(cursor, granularity);
    const asOf = periodEnd > now ? now : periodEnd;
    points.push({
      periodEnd: toIsoDay(periodEnd),
      label: formatPeriodLabel(cursor, granularity),
      engagementScore: computeScoreAsOf(asOf, input.logins, input.activities, input.feedback),
      riskScore: latestRiskAsOf(asOf, input.risks),
    });
    cursor = periodEnd;
    count += 1;
  }

  return points;
}
