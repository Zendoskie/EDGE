/** True when the current URL is from a Supabase password-recovery redirect. */
export function urlIndicatesPasswordRecovery(): boolean {
  const hash = window.location.hash;
  const search = window.location.search;
  return hash.includes('type=recovery') || search.includes('type=recovery');
}
