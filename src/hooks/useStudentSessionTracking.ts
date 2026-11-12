import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  TRACKING_IDLE_TIMEOUT_MS,
  finalizeStudentSessionKeepalive,
  getSessionHeartbeatIntervalMs,
  resumeStudentSession,
  updateSessionHeartbeat,
} from '@/lib/track-activity';

/**
 * Tracks student active time with heartbeats.
 *
 * Time only accrues while the dashboard tab is visible and the student has
 * interacted recently. A tab left open (or hidden) stops adding time, which is
 * what keeps "4 minutes" from turning into "1 hour".
 *
 * Login count is only incremented via trackStudentLogin() on successful sign-in.
 */
export function useStudentSessionTracking() {
  const { user, role } = useAuth();

  useEffect(() => {
    if (role !== 'student' || !user?.id) return;

    let cancelled = false;
    let lastInteractionAt = Date.now();

    const isIdle = () => Date.now() - lastInteractionAt >= TRACKING_IDLE_TIMEOUT_MS;

    const markInteraction = () => {
      const wasIdle = isIdle();
      lastInteractionAt = Date.now();
      if (wasIdle) {
        // Restart the measurement window without crediting the idle gap.
        void updateSessionHeartbeat('resume');
      }
    };

    const bootstrap = async () => {
      await resumeStudentSession();
    };
    const bootstrapTimer = window.setTimeout(() => {
      void bootstrap();
    }, 2_000);

    const beat = () => {
      if (cancelled) return;
      if (document.visibilityState === 'hidden') return;
      if (isIdle()) return;
      void updateSessionHeartbeat('heartbeat');
    };
    const heartbeatId = window.setInterval(beat, getSessionHeartbeatIntervalMs());

    const handleBeforeUnload = () => {
      finalizeStudentSessionKeepalive();
    };
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      lastInteractionAt = Date.now();
      void updateSessionHeartbeat('resume');
    };

    const interactionEvents = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibility);
    for (const eventName of interactionEvents) {
      window.addEventListener(eventName, markInteraction, { passive: true });
    }

    return () => {
      cancelled = true;
      window.clearTimeout(bootstrapTimer);
      window.clearInterval(heartbeatId);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibility);
      for (const eventName of interactionEvents) {
        window.removeEventListener(eventName, markInteraction);
      }
    };
  }, [role, user?.id]);
}
