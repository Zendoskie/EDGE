import { useStudentEngagementSummary } from '@/hooks/useStudentEngagementSummary';
import type { EngagementMetrics } from '@/lib/track-activity';

/**
 * Login count, time, and last login from the shared engagement-summary query.
 * Does not read student_login_history and does not recompute.
 */
export function useStudentEngagementMetrics(studentId: string | undefined | null) {
  const { summary, isLoading, error } = useStudentEngagementSummary(studentId);

  const metrics: EngagementMetrics | null = summary
    ? {
        total_login_count: summary.total_login_count,
        total_time_spent_seconds: summary.total_time_spent_seconds,
        last_login_at: summary.last_login_at,
      }
    : null;

  return {
    metrics,
    isLoading,
    error,
  };
}
