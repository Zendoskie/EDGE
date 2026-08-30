import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { subscribeEngagementInvalidation } from '@/lib/engagement-cache';

export type StudentEngagementSummaryRow = {
  student_id: string;
  engagement_level: string;
  engagement_score: number;
  previous_engagement_level: string | null;
  previous_engagement_score: number | null;
  total_login_count: number;
  total_time_spent_seconds: number;
  last_login_at: string | null;
  assignments_submitted: number;
  ai_sessions: number;
  feedback_count: number;
};

/**
 * Live engagement summary for a single student.
 * Callers must pass the authenticated student's own id for student self-views.
 */
export function useStudentEngagementSummary(studentId: string | undefined | null) {
  const query = useQuery({
    queryKey: ['student-engagement-summary', studentId],
    queryFn: async (): Promise<StudentEngagementSummaryRow | null> => {
      const { error: recomputeError } = await supabase.rpc('recompute_student_engagement', {
        p_student_id: studentId!,
      });
      if (recomputeError) {
        console.warn('recompute failed:', recomputeError.message);
      }

      const { data, error } = await supabase
        .from('student_engagement_summary')
        .select(
          'student_id, engagement_level, engagement_score, previous_engagement_level, previous_engagement_score, total_login_count, total_time_spent_seconds, last_login_at, assignments_submitted, ai_sessions, feedback_count',
        )
        .eq('student_id', studentId!)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      return {
        student_id: data.student_id,
        engagement_level: data.engagement_level,
        engagement_score: Number(data.engagement_score ?? 0),
        previous_engagement_level: data.previous_engagement_level ?? null,
        previous_engagement_score:
          data.previous_engagement_score == null ? null : Number(data.previous_engagement_score),
        total_login_count: data.total_login_count ?? 0,
        total_time_spent_seconds: data.total_time_spent_seconds ?? 0,
        last_login_at: data.last_login_at ?? null,
        assignments_submitted: data.assignments_submitted ?? 0,
        ai_sessions: data.ai_sessions ?? 0,
        feedback_count: data.feedback_count ?? 0,
      };
    },
    enabled: !!studentId,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!studentId) return;
    return subscribeEngagementInvalidation((invalidatedId) => {
      if (invalidatedId === studentId) {
        void query.refetch();
      }
    });
  }, [studentId, query]);

  return {
    summary: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
