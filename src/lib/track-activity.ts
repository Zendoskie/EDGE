import { supabase } from '@/integrations/supabase/client';
import type { Session } from '@supabase/supabase-js';
import type { EngagementActivityType } from '@/lib/engagement-config';
import { invalidateEngagementQueries } from '@/lib/engagement-cache';

export type StudentAuthContext = {
  accessToken: string;
  userId: string;
};

export type EngagementMetrics = {
  total_login_count: number;
  total_time_spent_seconds: number;
  last_login_at: string | null;
};

/** How a session beat is credited. See touch_student_session in the database. */
export type SessionBeatMode = 'heartbeat' | 'resume' | 'finalize';

const LOGIN_SESSION_KEY = 'edge_login_session_id';
const LOGIN_IN_PROGRESS_KEY = 'edge_login_in_progress';
const LOGIN_TRACKED_KEY = 'edge_login_tracked_token';
const DEDUP_PREFIX = 'edge_activity_dedup_';

const HEARTBEAT_INTERVAL_MS = 60_000;
const LOGIN_DEDUP_MS = 60_000;

/**
 * The student is considered idle after this long without interaction.
 * Heartbeats pause while idle, so a tab left open does not keep adding time.
 */
export const TRACKING_IDLE_TIMEOUT_MS = 5 * 60_000;

/** Fired after a heartbeat/login so open time-spent views can refresh. */
export const ENGAGEMENT_TICK_EVENT = 'edge-engagement-tick';

export type EngagementTickDetail = {
  studentId: string;
  at: number;
};

type TrackActivityParams = {
  activityType: EngagementActivityType;
  subjectId?: string | null;
  description?: string | null;
  sourceId?: string | null;
};

export function parseUserAgent(ua: string): { device: string; browser: string } {
  const lower = ua.toLowerCase();
  let device = 'Desktop';
  if (/mobile|android|iphone|ipad|ipod/.test(lower)) device = 'Mobile';
  else if (/tablet/.test(lower)) device = 'Tablet';

  let browser = 'Unknown';
  if (lower.includes('edg/')) browser = 'Edge';
  else if (lower.includes('chrome/') && !lower.includes('chromium')) browser = 'Chrome';
  else if (lower.includes('firefox/')) browser = 'Firefox';
  else if (lower.includes('safari/') && !lower.includes('chrome')) browser = 'Safari';
  else if (lower.includes('opera') || lower.includes('opr/')) browser = 'Opera';

  return { device, browser };
}

function dedupeKey(type: string, subjectId?: string | null): string {
  const day = new Date().toISOString().slice(0, 10);
  return `${type}:${subjectId ?? 'global'}:${day}`;
}

function isRecentlyTracked(key: string): boolean {
  try {
    return sessionStorage.getItem(`${DEDUP_PREFIX}${key}`) === '1';
  } catch {
    return false;
  }
}

function markTracked(key: string): void {
  try {
    sessionStorage.setItem(`${DEDUP_PREFIX}${key}`, '1');
  } catch {
    /* ignore */
  }
}

const LOGIN_IN_PROGRESS_MAX_MS = 30_000;

function setLoginInProgress(active: boolean): void {
  try {
    if (active) sessionStorage.setItem(LOGIN_IN_PROGRESS_KEY, String(Date.now()));
    else sessionStorage.removeItem(LOGIN_IN_PROGRESS_KEY);
  } catch {
    /* ignore */
  }
}

function isLoginInProgress(): boolean {
  try {
    const raw = sessionStorage.getItem(LOGIN_IN_PROGRESS_KEY);
    if (!raw) return false;
    const startedAt = Number(raw);
    // A tab that was closed mid-login leaves the marker behind; expire it.
    if (!Number.isFinite(startedAt) || Date.now() - startedAt > LOGIN_IN_PROGRESS_MAX_MS) {
      sessionStorage.removeItem(LOGIN_IN_PROGRESS_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function storeLoginSessionId(id: string): void {
  try {
    localStorage.setItem(LOGIN_SESSION_KEY, id);
  } catch {
    /* ignore */
  }
}

export function getStoredLoginSessionId(): string | null {
  try {
    return localStorage.getItem(LOGIN_SESSION_KEY);
  } catch {
    return null;
  }
}

export function clearStoredLoginSessionId(): void {
  try {
    localStorage.removeItem(LOGIN_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function authContextFromSession(session: Session | null | undefined): StudentAuthContext | null {
  if (!session?.access_token || !session.user?.id) return null;
  return { accessToken: session.access_token, userId: session.user.id };
}

async function getAuthContext(): Promise<StudentAuthContext | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token || !session.user?.id) return null;
  return { accessToken: session.access_token, userId: session.user.id };
}

async function resolveAuthContext(
  explicit?: StudentAuthContext | null,
): Promise<StudentAuthContext | null> {
  if (explicit?.accessToken && explicit.userId) return explicit;

  for (let attempt = 0; attempt < 6; attempt++) {
    const ctx = await getAuthContext();
    if (ctx) return ctx;
    await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
  }

  return null;
}

function getSupabaseFunctionBase(): string | null {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '');
  return base ?? null;
}

function getAnonKey(): string | null {
  return (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? null;
}

function isMissingRpc(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  return (error.message ?? '').toLowerCase().includes('could not find the function');
}

function warnOnce(key: string, message: string): void {
  try {
    const marker = `edge_warned_${key}`;
    if (sessionStorage.getItem(marker) === '1') return;
    sessionStorage.setItem(marker, '1');
  } catch {
    /* ignore */
  }
  console.warn(message);
}

function notifyEngagementTick(studentId: string): void {
  if (typeof window === 'undefined' || !studentId) return;
  window.dispatchEvent(
    new CustomEvent<EngagementTickDetail>(ENGAGEMENT_TICK_EVENT, {
      detail: { studentId, at: Date.now() },
    }),
  );
}

type SessionBeatRow = {
  ok?: boolean;
  session_id?: string;
  active_seconds?: number;
  closed?: boolean;
};

async function touchTrackedSession(
  sessionId: string,
  mode: SessionBeatMode,
): Promise<SessionBeatRow | null> {
  const { data, error } = await supabase.rpc('touch_student_session', {
    p_session_id: sessionId,
    p_mode: mode,
  });

  if (error) {
    if (typeof error.code === 'string' && error.code === 'P0002') {
      clearStoredLoginSessionId();
    } else if (isMissingRpc(error)) {
      warnOnce(
        'touch-session-rpc',
        '[engagement] touch_student_session is missing. Apply migration 20261110130000_engagement_active_time_and_periods.sql.',
      );
    } else {
      console.warn('[engagement] session beat failed:', error.message);
    }
    return null;
  }

  const row = (Array.isArray(data) ? data[0] : data) as SessionBeatRow | null;
  return row ?? null;
}

/**
 * Reuse the live session, or open one that does not count as a login.
 * Returns the session id, or null when tracking is unavailable.
 */
export async function ensureTrackedSession(): Promise<string | null> {
  const stored = getStoredLoginSessionId();
  if (stored) return stored;

  const { data, error } = await supabase.rpc('start_student_session');

  if (error) {
    if (isMissingRpc(error)) {
      warnOnce(
        'start-session-rpc',
        '[engagement] start_student_session is missing. Apply migration 20261110130000_engagement_active_time_and_periods.sql.',
      );
    } else {
      console.warn('[engagement] start_student_session failed:', error.message);
    }
    return null;
  }

  const sessionId = typeof data === 'string' ? data : null;
  if (sessionId) storeLoginSessionId(sessionId);
  return sessionId;
}

async function insertLoginSessionDirect(
  studentId: string,
  countsAsLogin: boolean,
  device: string,
  browser: string,
): Promise<string | undefined> {
  // login_time is left to the database default so it uses server time, not the
  // student's clock. The first heartbeat measures from it and is capped at 90s.
  const { data, error } = await supabase
    .from('student_login_history')
    .insert({
      student_id: studentId,
      device,
      browser,
      counts_as_login: countsAsLogin,
    })
    .select('id')
    .single();

  if (error) {
    console.warn('[engagement] insert login session failed:', error.message);
    return undefined;
  }

  return data?.id;
}

async function insertLoginSessionViaEdge(
  accessToken: string,
  ua: string,
  device: string,
  browser: string,
): Promise<string | undefined> {
  const base = getSupabaseFunctionBase();
  const anonKey = getAnonKey();
  if (!base || !anonKey) return undefined;

  try {
    const res = await fetch(`${base}/functions/v1/track-student-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey,
      },
      body: JSON.stringify({ userAgent: ua, device, browser }),
    });

    const json = (await res.json().catch(() => ({}))) as { loginId?: string; error?: string };

    if (json.loginId) return json.loginId;

    if (!res.ok) {
      console.warn('track-student-login failed:', json.error ?? res.statusText);
    }
  } catch (err) {
    console.warn('track-student-login failed:', err);
  }

  return undefined;
}

function markLoginTracked(accessToken: string): void {
  try {
    sessionStorage.setItem(LOGIN_TRACKED_KEY, accessToken.slice(-24));
    sessionStorage.setItem(`${LOGIN_TRACKED_KEY}_at`, String(Date.now()));
  } catch {
    /* ignore */
  }
}

function wasLoginTrackedRecently(accessToken: string): boolean {
  try {
    const token = sessionStorage.getItem(LOGIN_TRACKED_KEY);
    const trackedAt = Number(sessionStorage.getItem(`${LOGIN_TRACKED_KEY}_at`) || 0);
    if (!token || token !== accessToken.slice(-24)) return false;
    return Date.now() - trackedAt < LOGIN_DEDUP_MS;
  } catch {
    return false;
  }
}

/** Called only after a successful sign-in — increments Total Logins. */
export async function trackStudentLogin(auth?: StudentAuthContext | null): Promise<void> {
  if (isLoginInProgress()) return;

  // Set the guard before awaiting so two near-simultaneous sign-in callbacks
  // (explicit signIn() plus the SIGNED_IN event) cannot record two logins.
  setLoginInProgress(true);
  try {
    const resolved = await resolveAuthContext(auth);
    if (!resolved) {
      console.warn('[engagement] trackStudentLogin skipped: no auth session');
      return;
    }

    if (wasLoginTrackedRecently(resolved.accessToken)) return;

    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const { device, browser } = parseUserAgent(ua);

    let loginId = await insertLoginSessionDirect(resolved.userId, true, device, browser);
    if (!loginId) {
      loginId = await insertLoginSessionViaEdge(resolved.accessToken, ua, device, browser);
    }

    if (!loginId) {
      console.warn('[engagement] trackStudentLogin failed: could not create login session');
      return;
    }

    markLoginTracked(resolved.accessToken);
    storeLoginSessionId(loginId);
    invalidateEngagementQueries(resolved.userId);
    notifyEngagementTick(resolved.userId);
  } catch (err) {
    console.warn('[engagement] trackStudentLogin failed:', err);
  } finally {
    setLoginInProgress(false);
  }
}

/**
 * If the student has an auth session but no counted logins yet, record one.
 * Covers restored sessions where signIn() was not called.
 */
export async function ensureLoginRecorded(auth?: StudentAuthContext | null): Promise<void> {
  const resolved = await resolveAuthContext(auth);
  if (!resolved) return;

  const { count, error } = await supabase
    .from('student_login_history')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', resolved.userId)
    .or('counts_as_login.is.null,counts_as_login.eq.true');

  if (error) {
    console.warn('[engagement] ensureLoginRecorded check failed:', error.message);
    return;
  }

  if ((count ?? 0) > 0) return;

  console.info('[engagement] no login history found — recording first login');
  await trackStudentLogin(resolved);
}

/**
 * Resume time tracking after a reload or revisit. Never counts as a login and
 * never credits the time the student was away.
 */
export async function resumeStudentSession(auth?: StudentAuthContext | null): Promise<void> {
  if (isLoginInProgress()) return;

  try {
    const resolved = await resolveAuthContext(auth);
    if (!resolved) return;

    const sessionId = await ensureTrackedSession();
    if (sessionId) invalidateEngagementQueries(resolved.userId);
  } catch (err) {
    console.warn('resumeStudentSession failed:', err);
  }
}

/**
 * Send one beat for the open session.
 * `heartbeat` credits up to 90 seconds, `resume` restarts the window without
 * crediting the gap, and `finalize` credits the last window and closes.
 */
export async function updateSessionHeartbeat(mode: SessionBeatMode = 'heartbeat'): Promise<void> {
  if (isLoginInProgress()) return;

  try {
    const auth = await getAuthContext();
    if (!auth) return;

    const sessionId = getStoredLoginSessionId() ?? (await ensureTrackedSession());
    if (!sessionId) return;

    const row = await touchTrackedSession(sessionId, mode);

    if (row?.closed && mode !== 'finalize') {
      // The session was closed elsewhere (logout in another tab, stale sweep).
      clearStoredLoginSessionId();
      return;
    }

    if (row?.ok) {
      notifyEngagementTick(auth.userId);
    }

    if (mode === 'finalize') {
      clearStoredLoginSessionId();
      invalidateEngagementQueries(auth.userId);
    }
  } catch (err) {
    console.warn('updateSessionHeartbeat failed:', err);
  }
}

/** Finalize the active session and accumulate measured session time. */
export async function finalizeStudentSession(): Promise<void> {
  const loginId = getStoredLoginSessionId();
  if (!loginId) return;

  try {
    const auth = await resolveAuthContext();
    if (!auth) return;

    const row = await touchTrackedSession(loginId, 'finalize');
    if (row?.ok || row?.closed) {
      clearStoredLoginSessionId();
      invalidateEngagementQueries(auth.userId);
      notifyEngagementTick(auth.userId);
    }
  } catch (err) {
    console.warn('finalizeStudentSession failed:', err);
  }
}

/**
 * Reliable finalize for page unload — uses keepalive fetch so the request can
 * complete after the tab closes.
 */
export function finalizeStudentSessionKeepalive(): void {
  const loginId = getStoredLoginSessionId();
  if (!loginId) return;

  const base = getSupabaseFunctionBase();
  const anonKey = getAnonKey();
  if (!base || !anonKey) {
    void finalizeStudentSession();
    return;
  }

  void (async () => {
    const auth = await getAuthContext();
    if (!auth) return;

    try {
      const res = await fetch(`${base}/rest/v1/rpc/touch_student_session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.accessToken}`,
          apikey: anonKey,
        },
        body: JSON.stringify({ p_session_id: loginId, p_mode: 'finalize' }),
        keepalive: true,
      });

      if (res.ok) {
        clearStoredLoginSessionId();
        invalidateEngagementQueries(auth.userId);
        return;
      }
    } catch {
      /* fall through */
    }

    void finalizeStudentSession();
  })();
}

export async function trackStudentLogout(): Promise<void> {
  await finalizeStudentSession();
}

export function getSessionHeartbeatIntervalMs(): number {
  return HEARTBEAT_INTERVAL_MS;
}

export async function trackStudentActivity(params: TrackActivityParams): Promise<void> {
  const { activityType, subjectId, description, sourceId } = params;

  if (!sourceId && subjectId) {
    const key = dedupeKey(activityType, subjectId);
    if (isRecentlyTracked(key)) return;
    markTracked(key);
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from('student_activity').insert({
      student_id: user.id,
      activity_type: activityType,
      activity_description: description ?? null,
      subject_id: subjectId ?? null,
      source_id: sourceId ?? null,
    });
    if (error && error.code !== '23505') {
      console.warn('trackStudentActivity failed:', error.message);
    }
  } catch (err) {
    console.warn('trackStudentActivity failed:', err);
  }
}
