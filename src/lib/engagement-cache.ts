const ENGAGEMENT_INVALIDATE_EVENT = 'edge-engagement-invalidate';

export function invalidateEngagementQueries(studentId: string): void {
  if (typeof window === 'undefined' || !studentId) return;
  window.dispatchEvent(
    new CustomEvent(ENGAGEMENT_INVALIDATE_EVENT, { detail: { studentId } }),
  );
}

export function subscribeEngagementInvalidation(
  callback: (studentId: string) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = (event: Event) => {
    const studentId = (event as CustomEvent<{ studentId?: string }>).detail?.studentId;
    if (studentId) callback(studentId);
  };

  window.addEventListener(ENGAGEMENT_INVALIDATE_EVENT, handler);
  return () => window.removeEventListener(ENGAGEMENT_INVALIDATE_EVENT, handler);
}
