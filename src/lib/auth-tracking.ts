/** Thin wrappers so auth code never statically imports track-activity (avoids circular deps). */

export async function bootstrapStudentSession(): Promise<void> {
  const { resumeStudentSession, ensureLoginRecorded } = await import('@/lib/track-activity');
  await ensureLoginRecorded();
  await resumeStudentSession();
}

export async function trackStudentLoginOnSignIn(): Promise<void> {
  const { trackStudentLogin } = await import('@/lib/track-activity');
  await trackStudentLogin();
}

export async function trackStudentLogoutOnSignOut(): Promise<void> {
  const { trackStudentLogout } = await import('@/lib/track-activity');
  await trackStudentLogout();
}

export async function finalizeStudentSessionOnSignOut(): Promise<void> {
  const { finalizeStudentSession } = await import('@/lib/track-activity');
  await finalizeStudentSession();
}
