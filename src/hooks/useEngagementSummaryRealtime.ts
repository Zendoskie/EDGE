import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { subscribeEngagementInvalidation } from '@/lib/engagement-cache';

function invalidateEngagementKeys(queryClient: ReturnType<typeof useQueryClient>, studentId: string) {
  void queryClient.invalidateQueries({ queryKey: ['student-engagement-metrics', studentId] });
  void queryClient.invalidateQueries({ queryKey: ['student-engagement-summary', studentId] });
  void queryClient.invalidateQueries({ queryKey: ['student-engagement-panel-summary', studentId] });
  void queryClient.invalidateQueries({ queryKey: ['student-engagement-panel-activities', studentId] });
  void queryClient.invalidateQueries({ queryKey: ['student-engagement-panel-logins', studentId] });
  void queryClient.invalidateQueries({ queryKey: ['student-engagement-subject-counts', studentId] });
  void queryClient.invalidateQueries({ queryKey: ['predictions-engagement'] });
}

export function useEngagementSummaryRealtime() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user?.id) return;

    const unsubscribeLocal = subscribeEngagementInvalidation((studentId) => {
      invalidateEngagementKeys(queryClient, studentId);
    });

    const channel = supabase
      .channel(`engagement-summary-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'student_engagement_summary',
          filter: `student_id=eq.${user.id}`,
        },
        () => {
          invalidateEngagementKeys(queryClient, user.id);
        },
      )
      .subscribe();

    return () => {
      unsubscribeLocal();
      void supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);
}
