/** Prefix shared with supabase/functions/ai-coach/coach-chat.ts for proactive briefing detection. */
export const PROACTIVE_AT_RISK_BRIEFING_PREFIX = '[EDGE_PROACTIVE_AT_RISK_BRIEFING]';

export const PROACTIVE_AT_RISK_BRIEFING_PROMPT = `${PROACTIVE_AT_RISK_BRIEFING_PREFIX} I am classified as Crucial or Vulnerable in at least one subject. Using only my official student record, explain exactly which scores or weighted components placed me in this status and why. Then give me a concrete 7-day study plan to move toward Stable (80% or above on the risk score) and avoid staying Crucial or Vulnerable. Assume about 1 hour on weekdays if I did not state otherwise.`;

export function coachClosedThisSessionKey(userId: string): string {
  return `edge_ai_coach_closed_this_session:${userId}`;
}

export function proactiveBriefingDoneSessionKey(userId: string): string {
  return `edge_ai_coach_proactive_briefing_done:${userId}`;
}

export function isCoachClosedThisSession(userId: string | undefined): boolean {
  if (!userId || typeof sessionStorage === 'undefined') return false;
  try {
    return sessionStorage.getItem(coachClosedThisSessionKey(userId)) === '1';
  } catch {
    return false;
  }
}

export function markCoachClosedThisSession(userId: string): void {
  try {
    sessionStorage.setItem(coachClosedThisSessionKey(userId), '1');
  } catch {
    /* ignore */
  }
}

export function isProactiveBriefingDoneThisSession(userId: string | undefined): boolean {
  if (!userId || typeof sessionStorage === 'undefined') return false;
  try {
    return sessionStorage.getItem(proactiveBriefingDoneSessionKey(userId)) === '1';
  } catch {
    return false;
  }
}

export function markProactiveBriefingDoneThisSession(userId: string): void {
  try {
    sessionStorage.setItem(proactiveBriefingDoneSessionKey(userId), '1');
  } catch {
    /* ignore */
  }
}

export function clearProactiveBriefingDoneThisSession(userId: string): void {
  try {
    sessionStorage.removeItem(proactiveBriefingDoneSessionKey(userId));
  } catch {
    /* ignore */
  }
}
