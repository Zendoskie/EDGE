import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  PARENT_ENGAGEMENT_CONFIG,
  summarizeParentEngagement,
  summarizeParentEngagementByParent,
  type ParentEngagementSummary,
} from '@/lib/parent-engagement';

function windowStartIso(): string {
  const start = Date.now() - PARENT_ENGAGEMENT_CONFIG.windowDays * 24 * 60 * 60 * 1000;
  return new Date(start).toISOString();
}

function friendlyCheckInError(error: { code?: string; message?: string }): Error {
  if (error.code === '42P01') {
    return new Error('Parent check-ins are not enabled on this database yet.');
  }
  return error instanceof Error ? error : new Error(error.message ?? 'Could not load parent check-ins.');
}

/**
 * The signed-in parent's own check-in engagement for one linked student.
 */
export function useParentEngagement(studentId: string | undefined | null, enabled = true) {
  const { user, role } = useAuth();

  const query = useQuery({
    queryKey: ['parent-engagement', user?.id, studentId],
    enabled: enabled && role === 'parent' && !!user?.id && !!studentId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<ParentEngagementSummary> => {
      const { data, error } = await supabase
        .from('parent_student_views')
        .select('viewed_at')
        .eq('parent_user_id', user!.id)
        .eq('student_user_id', studentId!)
        .gte('viewed_at', windowStartIso())
        .order('viewed_at', { ascending: false });

      if (error) throw friendlyCheckInError(error);
      return summarizeParentEngagement((data ?? []).map((row) => row.viewed_at));
    },
  });

  return {
    engagement: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

/**
 * Instructor/admin view of how often the student's linked parents check in.
 * Reports the most active parent in the rolling window.
 */
export function useStudentParentEngagement(studentId: string | undefined | null, enabled = true) {
  const query = useQuery({
    queryKey: ['student-parent-engagement', studentId],
    enabled: enabled && !!studentId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('parent_student_views')
        .select('parent_user_id, viewed_at')
        .eq('student_user_id', studentId!)
        .gte('viewed_at', windowStartIso());

      if (error) throw friendlyCheckInError(error);
      return summarizeParentEngagementByParent(data ?? []);
    },
  });

  return {
    summary: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}
