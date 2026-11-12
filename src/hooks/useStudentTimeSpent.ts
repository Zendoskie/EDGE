import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { subscribeEngagementInvalidation } from '@/lib/engagement-cache';
import {
  ENGAGEMENT_TICK_EVENT,
  TRACKING_IDLE_TIMEOUT_MS,
  type EngagementTickDetail,
} from '@/lib/track-activity';
import {
  EMPTY_STUDENT_TIME_SPENT,
  applyLiveDelta,
  normalizeStudentTimeSpent,
  type StudentTimeSpent,
} from '@/lib/engagement-periods';

/** Matches the server's per-beat credit cap in touch_student_session. */
const MAX_LIVE_DELTA_SECONDS = 120;

/**
 * Measured active time for one student, bucketed by period.
 * Today / Yesterday / This week / This month are computed in the database
 * (Asia/Manila reporting day) and respect RLS for the signed-in role.
 *
 * The student's own view ticks locally every second while the tab is visible and
 * the student is interacting, and reconciles with the authoritative server value:
 *   - each heartbeat fires ENGAGEMENT_TICK_EVENT and triggers a refetch,
 *   - the query also refreshes on mount, tab visibility, and window focus,
 *   - engagement changes (login/logout) invalidate it.
 * It deliberately does not poll the database; the one-second ticker is local UI
 * only and is reconciled by the next server read.
 */
export function useStudentTimeSpent(studentId: string | undefined | null) {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();

  const isSelf = role === 'student' && !!studentId && user?.id === studentId;
  const activeElapsedRef = useRef(0);
  const lastInteractionRef = useRef(Date.now());
  const [, setTick] = useState(0);

  const query = useQuery({
    queryKey: ['student-time-spent', studentId],
    enabled: !!studentId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<StudentTimeSpent> => {
      const { data, error } = await supabase.rpc('get_student_time_spent', {
        p_student_id: studentId!,
      });
      if (error) {
        const missing =
          error.code === 'PGRST202' ||
          error.code === '42883' ||
          (error.message ?? '').toLowerCase().includes('get_student_time_spent');
        if (missing) {
          throw new Error('Time tracking is not enabled on this database yet.');
        }
        throw error;
      }
      const row = Array.isArray(data) ? data[0] : data;
      const normalized = normalizeStudentTimeSpent(row);
      // The server total now includes everything observed so far.
      activeElapsedRef.current = 0;
      return normalized;
    },
  });

  const { refetch } = query;

  useEffect(() => {
    if (!studentId) return;

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        activeElapsedRef.current = 0;
        lastInteractionRef.current = Date.now();
        void refetch();
      }
    };

    const handleTick = (event: Event) => {
      const detail = (event as CustomEvent<EngagementTickDetail>).detail;
      if (!detail || detail.studentId !== studentId) return;
      void refetch();
    };

    const unsubscribe = subscribeEngagementInvalidation((changedStudentId) => {
      if (changedStudentId !== studentId) return;
      void queryClient.invalidateQueries({ queryKey: ['student-time-spent', studentId] });
    });

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener(ENGAGEMENT_TICK_EVENT, handleTick);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener(ENGAGEMENT_TICK_EVENT, handleTick);
      unsubscribe();
    };
  }, [queryClient, studentId, refetch]);

  useEffect(() => {
    if (!isSelf) {
      activeElapsedRef.current = 0;
      return;
    }

    const markInteraction = () => {
      lastInteractionRef.current = Date.now();
    };

    const interactionEvents = ['pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart'] as const;
    for (const eventName of interactionEvents) {
      window.addEventListener(eventName, markInteraction, { passive: true });
    }

    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastInteractionRef.current >= TRACKING_IDLE_TIMEOUT_MS) return;

      activeElapsedRef.current = Math.min(
        MAX_LIVE_DELTA_SECONDS,
        activeElapsedRef.current + 1,
      );
      setTick((value) => value + 1);
    }, 1_000);

    return () => {
      window.clearInterval(interval);
      for (const eventName of interactionEvents) {
        window.removeEventListener(eventName, markInteraction);
      }
    };
  }, [isSelf]);

  const base = query.data ?? EMPTY_STUDENT_TIME_SPENT;
  const liveDelta = isSelf ? activeElapsedRef.current : 0;

  return {
    timeSpent: applyLiveDelta(base, liveDelta),
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch,
  };
}
