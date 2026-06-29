import { supabase } from '@/integrations/supabase/client';
import type { EngagementActivityType } from '@/lib/engagement-config';

const LOGIN_SESSION_KEY = 'edge_login_session_id';
const DEDUP_PREFIX = 'edge_activity_dedup_';

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

export async function trackStudentLogin(): Promise<void> {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const { device, browser } = parseUserAgent(ua);

  try {
    const {
      data: { session, user },
    } = await supabase.auth.getSession();
    if (!session?.access_token || !user) return;

    const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '');
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

    let loginId: string | undefined;

    if (base && anonKey) {
      try {
        const res = await fetch(`${base}/functions/v1/track-student-login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
            apikey: anonKey,
          },
          body: JSON.stringify({ userAgent: ua, device, browser }),
        });

        if (res.ok) {
          const json = (await res.json().catch(() => ({}))) as { loginId?: string };
          loginId = json.loginId;
        }
      } catch {
        /* fall through to direct insert */
      }
    }

    if (!loginId) {
      const { data: inserted, error } = await supabase
        .from('student_login_history')
        .insert({
          student_id: user.id,
          login_time: new Date().toISOString(),
          device,
          browser,
        })
        .select('id')
        .single();

      if (error) {
        console.warn('trackStudentLogin direct insert failed:', error.message);
        return;
      }
      loginId = inserted.id;
    }

    if (loginId) storeLoginSessionId(loginId);
  } catch (err) {
    console.warn('trackStudentLogin failed:', err);
  }
}

export async function trackStudentLogout(): Promise<void> {
  const loginId = getStoredLoginSessionId();
  if (!loginId) return;

  try {
    const logoutTime = new Date().toISOString();
    const { data: row } = await supabase
      .from('student_login_history')
      .select('login_time')
      .eq('id', loginId)
      .maybeSingle();

    let sessionDuration: number | null = null;
    if (row?.login_time) {
      const start = Date.parse(row.login_time);
      const end = Date.parse(logoutTime);
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        sessionDuration = Math.round((end - start) / 1000);
      }
    }

    await supabase
      .from('student_login_history')
      .update({
        logout_time: logoutTime,
        session_duration: sessionDuration,
      })
      .eq('id', loginId);

    clearStoredLoginSessionId();
  } catch (err) {
    console.warn('trackStudentLogout failed:', err);
  }
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

    const row: Record<string, unknown> = {
      student_id: user.id,
      activity_type: activityType,
      activity_description: description ?? null,
      subject_id: subjectId ?? null,
      source_id: sourceId ?? null,
    };

    const { error } = await supabase.from('student_activity').insert(row);
    if (error && error.code !== '23505') {
      console.warn('trackStudentActivity failed:', error.message);
    }
  } catch (err) {
    console.warn('trackStudentActivity failed:', err);
  }
}
