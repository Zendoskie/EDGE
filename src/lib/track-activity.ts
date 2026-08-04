import { supabase } from '@/integrations/supabase/client';
import type { Session } from '@supabase/supabase-js';
import type { EngagementActivityType } from '@/lib/engagement-config';
import { invalidateEngagementQueries } from '@/lib/engagement-cache';

export type StudentAuthContext = {
  accessToken: string;
  userId: string;
};

const LOGIN_SESSION_KEY = 'edge_login_session_id';
const LOGIN_IN_PROGRESS_KEY = 'edge_login_in_progress';
const LOGIN_TRACKED_KEY = 'edge_login_tracked_token';
const DEDUP_PREFIX = 'edge_activity_dedup_';
const HEARTBEAT_INTERVAL_MS = 30_000;
const LOGIN_DEDUP_MS = 60_000;

export type EngagementMetrics = {
  total_login_count: number;
  total_time_spent_seconds: number;
  last_login_at: string | null;
};

type SessionAction = 'resume' | 'heartbeat' | 'finalize';

type SyncSessionResponse = {
  ok?: boolean;
  skipped?: boolean;
  sessionId?: string;
  closed?: boolean;
  metrics?: EngagementMetrics;
  error?: string;
};

export type TrackActivityParams = {
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

function setLoginInProgress(active: boolean): void {
  try {
    if (active) sessionStorage.setItem(LOGIN_IN_PROGRESS_KEY, '1');
    else sessionStorage.removeItem(LOGIN_IN_PROGRESS_KEY);
  } catch {
    /* ignore */
  }
}

function isLoginInProgress(): boolean {
  try {
    return sessionStorage.getItem(LOGIN_IN_PROGRESS_KEY) === '1';
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

async function callSyncStudentSession(
  action: SessionAction,
  auth: StudentAuthContext,
  sessionId?: string,
): Promise<SyncSessionResponse | null> {
  const base = getSupabaseFunctionBase();
  const anonKey = getAnonKey();
  if (!base || !anonKey) return null;

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const body: Record<string, string> = { action };
  if (sessionId) body.sessionId = sessionId;
  if (action === 'resume') body.userAgent = ua;

  try {
    const res = await fetch(`${base}/functions/v1/sync-student-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.accessToken}`,
        apikey: anonKey,
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json().catch(() => ({}))) as SyncSessionResponse;
    if (!res.ok) {
      console.warn(`sync-student-session ${action} failed:`, json.error ?? res.statusText);
      if (json.closed) return json;
      return null;
    }
    return json;
  } catch (err) {
    console.warn(`sync-student-session ${action} failed:`, err);
    return null;
  }
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

async function findOpenSessionId(studentId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('student_login_history')
    .select('id')
    .eq('student_id', studentId)
    .is('logout_time', null)
    .order('login_time', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('findOpenSessionId failed:', error.message);
    return null;
  }

  return data?.id ?? null;
}

async function insertLoginSessionDirect(
  studentId: string,
  countsAsLogin: boolean,
  device: string,
  browser: string,
): Promise<string | undefined> {
  const { data: inserted, error } = await supabase
    .from('student_login_history')
    .insert({
      student_id: studentId,
      login_time: new Date().toISOString(),
      device,
      browser,
      counts_as_login: countsAsLogin,
    })
    .select('id')
    .single();

  if (error) {
    console.warn('[engagement] insertLoginSessionDirect failed:', error.message, error.details, error.hint);
    return undefined;
  }

  return inserted.id;
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

    const json = (await res.json().catch(() => ({}))) as {
      loginId?: string;
      skipped?: boolean;
      error?: string;
      recomputeError?: string | null;
    };

    if (json.recomputeError) {
      console.warn('track-student-login recompute failed:', json.recomputeError);
    }

    if (json.loginId) return json.loginId;

    if (!res.ok) {
      console.warn('track-student-login failed:', json.error ?? res.statusText);
    }
  } catch (err) {
    console.warn('track-student-login failed:', err);
  }

  return undefined;
}

async function refreshEngagementSummary(studentId: string): Promise<void> {
  const { error } = await supabase.rpc('recompute_student_engagement', {
    p_student_id: studentId,
  });
  if (error) console.warn('recompute failed:', error.message);
  invalidateEngagementQueries(studentId);
}

async function insertLoginSession(
  countsAsLogin: boolean,
  auth: StudentAuthContext,
): Promise<string | undefined> {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const { device, browser } = parseUserAgent(ua);

  let loginId: string | undefined;

  if (countsAsLogin) {
    loginId = await insertLoginSessionDirect(auth.userId, true, device, browser);
    if (!loginId) {
      loginId = await insertLoginSessionViaEdge(auth.accessToken, ua, device, browser);
    }
  } else {
    loginId = await insertLoginSessionDirect(auth.userId, false, device, browser);
    if (!loginId) {
      const edgeResult = await callSyncStudentSession('resume', auth);
      loginId = edgeResult?.sessionId;
    }
  }

  if (!loginId) return undefined;

  await refreshEngagementSummary(auth.userId);
  return loginId;
}

/** Called only after a successful sign-in — increments Total Logins. */
export async function trackStudentLogin(auth?: StudentAuthContext | null): Promise<void> {
  if (isLoginInProgress()) return;

  const resolved = await resolveAuthContext(auth);
  if (!resolved) {
    console.warn('[engagement] trackStudentLogin skipped: no auth session');
    return;
  }

  if (wasLoginTrackedRecently(resolved.accessToken)) return;

  setLoginInProgress(true);
  try {
    const loginId = await insertLoginSession(true, resolved);
    if (!loginId) {
      console.warn('[engagement] trackStudentLogin failed: could not create login session');
      return;
    }

    markLoginTracked(resolved.accessToken);
    storeLoginSessionId(loginId);
    await refreshEngagementSummary(resolved.userId);
    console.info('[engagement] login recorded:', loginId);
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
 * Resume time tracking when a student returns with an existing auth session
 * (page reload / revisit) without counting as a new login.
 */
export async function resumeStudentSession(auth?: StudentAuthContext | null): Promise<void> {
  if (isLoginInProgress()) return;

  try {
    const resolved = await resolveAuthContext(auth);
    if (!resolved) return;

    const storedId = getStoredLoginSessionId();
    if (storedId) {
      const { data: row } = await supabase
        .from('student_login_history')
        .select('logout_time')
        .eq('id', storedId)
        .eq('student_id', resolved.userId)
        .maybeSingle();
      if (row && !row.logout_time) return;
      if (row?.logout_time) clearStoredLoginSessionId();
    }

    const openSessionId = await findOpenSessionId(resolved.userId);
    if (openSessionId) {
      storeLoginSessionId(openSessionId);
      await refreshEngagementSummary(resolved.userId);
      return;
    }

    const edgeResult = await callSyncStudentSession('resume', resolved);
    if (edgeResult?.sessionId) {
      storeLoginSessionId(edgeResult.sessionId);
      await refreshEngagementSummary(resolved.userId);
      return;
    }

    const loginId = await insertLoginSession(false, resolved);
    if (!loginId) return;

    storeLoginSessionId(loginId);
    await refreshEngagementSummary(resolved.userId);
  } catch (err) {
    console.warn('resumeStudentSession failed:', err);
  }
}

async function updateSessionHeartbeatDirect(loginId: string): Promise<boolean> {
  const { data: row, error: readError } = await supabase
    .from('student_login_history')
    .select('login_time, student_id, logout_time')
    .eq('id', loginId)
    .maybeSingle();

  if (readError || !row?.login_time || row.logout_time) {
    if (row?.logout_time) clearStoredLoginSessionId();
    return false;
  }

  const start = Date.parse(row.login_time);
  if (!Number.isFinite(start)) return false;

  const sessionDuration = Math.max(0, Math.round((Date.now() - start) / 1000));
  const { error: updateError } = await supabase
    .from('student_login_history')
    .update({ session_duration: sessionDuration })
    .eq('id', loginId)
    .is('logout_time', null);

  if (updateError) {
    console.warn('updateSessionHeartbeat failed:', updateError.message);
    return false;
  }

  if (row.student_id) await refreshEngagementSummary(row.student_id);
  return true;
}

/**
 * Update elapsed time on the open session without closing it.
 * Keeps Total Time Spent accurate while the student is still active.
 */
export async function updateSessionHeartbeat(): Promise<void> {
  let loginId = getStoredLoginSessionId();

  try {
    const auth = await getAuthContext();
    if (!auth) return;

    if (!loginId) {
      loginId = await findOpenSessionId(auth.userId);
      if (loginId) storeLoginSessionId(loginId);
    }

    if (!loginId) return;

    const edgeResult = await callSyncStudentSession('heartbeat', auth, loginId);
    if (edgeResult?.closed) {
      clearStoredLoginSessionId();
      return;
    }
    if (edgeResult?.ok) {
      invalidateEngagementQueries(auth.userId);
      return;
    }

    await updateSessionHeartbeatDirect(loginId);
  } catch (err) {
    console.warn('updateSessionHeartbeat failed:', err);
  }
}

async function finalizeStudentSessionDirect(loginId: string): Promise<void> {
  const logoutTime = new Date().toISOString();
  const { data: row, error: readError } = await supabase
    .from('student_login_history')
    .select('login_time, student_id, logout_time')
    .eq('id', loginId)
    .maybeSingle();

  if (readError || !row || row.logout_time) {
    clearStoredLoginSessionId();
    return;
  }

  let sessionDuration: number | null = null;
  if (row.login_time) {
    const start = Date.parse(row.login_time);
    const end = Date.parse(logoutTime);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      sessionDuration = Math.round((end - start) / 1000);
    }
  }

  const { error: updateError } = await supabase
    .from('student_login_history')
    .update({
      logout_time: logoutTime,
      session_duration: sessionDuration,
    })
    .eq('id', loginId)
    .is('logout_time', null);

  if (updateError) {
    console.warn('finalizeStudentSession failed:', updateError.message);
    return;
  }

  clearStoredLoginSessionId();

  if (row.student_id) await refreshEngagementSummary(row.student_id);
}

/** Finalize the active session and accumulate session duration. */
export async function finalizeStudentSession(): Promise<void> {
  const loginId = getStoredLoginSessionId();
  if (!loginId) return;

  try {
    const auth = await resolveAuthContext();
    if (!auth) return;

    const edgeResult = await callSyncStudentSession('finalize', auth, loginId);
    if (edgeResult?.ok || edgeResult?.closed) {
      clearStoredLoginSessionId();
      invalidateEngagementQueries(auth.userId);
      return;
    }

    await finalizeStudentSessionDirect(loginId);
  } catch (err) {
    console.warn('finalizeStudentSession failed:', err);
  }
}

/**
 * Reliable finalize for page unload — uses keepalive fetch so the request
 * can complete after the tab closes.
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
      const res = await fetch(`${base}/functions/v1/sync-student-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.accessToken}`,
          apikey: anonKey,
        },
        body: JSON.stringify({ action: 'finalize', sessionId: loginId }),
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
