/** Thin wrappers so auth code never statically imports track-activity (avoids circular deps). */

import type { Session } from '@supabase/supabase-js';
import type { StudentAuthContext } from '@/lib/track-activity';

function authContextFromSession(session: Session | null | undefined): StudentAuthContext | null {
  if (!session?.access_token || !session.user?.id) return null;
  return { accessToken: session.access_token, userId: session.user.id };
}

export async function bootstrapStudentSession(session: Session): Promise<void> {
  const auth = authContextFromSession(session);
  if (!auth) return;

  const { resumeStudentSession, ensureLoginRecorded } = await import('@/lib/track-activity');
  await ensureLoginRecorded(auth);
  await resumeStudentSession(auth);
}

export async function trackStudentLoginOnSignIn(session: Session): Promise<void> {
  const auth = authContextFromSession(session);
  if (!auth) return;

  const { trackStudentLogin } = await import('@/lib/track-activity');
  await trackStudentLogin(auth);
}

export async function trackStudentLogoutOnSignOut(): Promise<void> {
  const { trackStudentLogout } = await import('@/lib/track-activity');
  await trackStudentLogout();
}

export async function finalizeStudentSessionOnSignOut(): Promise<void> {
  const { finalizeStudentSession } = await import('@/lib/track-activity');
  await finalizeStudentSession();
}
