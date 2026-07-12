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
    void bootstrap();

    const heartbeatId = window.setInterval(() => {
      void updateSessionHeartbeat();
    }, getSessionHeartbeatIntervalMs());

    const handleBeforeUnload = () => {
      finalizeStudentSessionKeepalive();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      cancelled = true;
      window.clearInterval(heartbeatId);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [role, user?.id]);
}
