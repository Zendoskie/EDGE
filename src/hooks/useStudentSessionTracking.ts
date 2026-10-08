import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  finalizeStudentSessionKeepalive,
  getSessionHeartbeatIntervalMs,
  resumeStudentSession,
  updateSessionHeartbeat,
} from '@/lib/track-activity';

/**
 * Tracks student session time with periodic heartbeats.
 * Login count is only incremented via trackStudentLogin() on successful sign-in.
 */
export function useStudentSessionTracking() {
  const { user, role } = useAuth();

  useEffect(() => {
    if (role !== 'student' || !user?.id) return;

    let cancelled = false;

    const bootstrap = async () => {
      await resumeStudentSession();
      if (!cancelled) await updateSessionHeartbeat();
    };
    const bootstrapDelayMs = 2_000;
    const bootstrapTimer = window.setTimeout(() => {
      void bootstrap();
    }, bootstrapDelayMs);

    const beat = () => {
      if (document.visibilityState === 'hidden') return;
      void updateSessionHeartbeat();
    };
    const heartbeatId = window.setInterval(beat, getSessionHeartbeatIntervalMs());

    const handleBeforeUnload = () => {
      finalizeStudentSessionKeepalive();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void updateSessionHeartbeat();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      window.clearTimeout(bootstrapTimer);
      window.clearInterval(heartbeatId);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [role, user?.id]);
}
