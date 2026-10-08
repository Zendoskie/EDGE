import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { subscribeEngagementInvalidation } from '@/lib/engagement-cache';

export function invalidateEngagementKeys(queryClient: ReturnType<typeof useQueryClient>, studentId: string) {
  void queryClient.invalidateQueries({ queryKey: ['student-engagement-metrics', studentId] });
  void queryClient.invalidateQueries({ queryKey: ['student-engagement-summary', studentId] });
  void queryClient.invalidateQueries({ queryKey: ['student-engagement-panel-summary', studentId] });
  void queryClient.invalidateQueries({ queryKey: ['student-engagement-panel-activities', studentId] });
  void queryClient.invalidateQueries({ queryKey: ['student-engagement-panel-logins', studentId] });
  void queryClient.invalidateQueries({ queryKey: ['student-engagement-subject-counts', studentId] });
  void queryClient.invalidateQueries({ queryKey: ['student-engagement-charts', studentId] });
  void queryClient.invalidateQueries({ queryKey: ['student-engagement-feedback', studentId] });
  void queryClient.invalidateQueries({ queryKey: ['student-engagement-alerts', studentId] });
  void queryClient.invalidateQueries({ queryKey: ['engagement-interventions', studentId] });
  void queryClient.invalidateQueries({ queryKey: ['instructor-student-engagement-monitoring'] });
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

    return () => {
      unsubscribeLocal();
    };
  }, [user?.id, queryClient]);
}
