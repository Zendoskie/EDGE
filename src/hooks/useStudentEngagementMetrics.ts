import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { subscribeEngagementInvalidation } from '@/lib/engagement-cache';
import type { EngagementMetrics } from '@/lib/track-activity';

type LoginHistoryRow = {
  login_time: string;
  logout_time: string | null;
  session_duration: number | null;
  counts_as_login: boolean | null;
};

function mergeMetrics(
  summary: EngagementMetrics | null,
  aggregate: EngagementMetrics,
): EngagementMetrics {
  if (!summary) return aggregate;

  const summaryLogins = summary.total_login_count ?? 0;
  const summaryTime = summary.total_time_spent_seconds ?? 0;
  const aggregateLogins = aggregate.total_login_count ?? 0;
  const aggregateTime = aggregate.total_time_spent_seconds ?? 0;

  let lastLoginAt = summary.last_login_at;
  if (aggregate.last_login_at && (!lastLoginAt || aggregate.last_login_at > lastLoginAt)) {
    lastLoginAt = aggregate.last_login_at;
  }

  return {
    total_login_count: Math.max(summaryLogins, aggregateLogins),
    total_time_spent_seconds: Math.max(summaryTime, aggregateTime),
    last_login_at: lastLoginAt,
  };
}

async function aggregateFromLoginHistory(studentId: string): Promise<EngagementMetrics> {
  const { data, error } = await supabase
    .from('student_login_history')
    .select('login_time, logout_time, session_duration, counts_as_login')
    .eq('student_id', studentId);

  if (error) throw error;

  const rows = (data ?? []) as LoginHistoryRow[];
  const now = Date.now();

  let totalLoginCount = 0;
  let lastLoginAt: string | null = null;
  let totalTimeSpentSeconds = 0;

  for (const row of rows) {
    if (row.counts_as_login !== false) {
      totalLoginCount += 1;
      if (!lastLoginAt || row.login_time > lastLoginAt) {
        lastLoginAt = row.login_time;
      }
    }

    if (row.session_duration != null) {
      totalTimeSpentSeconds += row.session_duration;
    } else if (row.logout_time && row.login_time) {
      const start = Date.parse(row.login_time);
      const end = Date.parse(row.logout_time);
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        totalTimeSpentSeconds += Math.round((end - start) / 1000);
      }
    } else if (row.login_time && !row.logout_time) {
      const start = Date.parse(row.login_time);
      if (Number.isFinite(start)) {
        totalTimeSpentSeconds += Math.max(0, Math.round((now - start) / 1000));
      }
    }
  }

  return {
    total_login_count: totalLoginCount,
    total_time_spent_seconds: totalTimeSpentSeconds,
    last_login_at: lastLoginAt,
  };
}

async function fetchEngagementMetrics(studentId: string): Promise<EngagementMetrics> {
  const aggregate = await aggregateFromLoginHistory(studentId);

  const { error: recomputeError } = await supabase.rpc('recompute_student_engagement', {
    p_student_id: studentId,
  });
  if (recomputeError) {
    console.warn('recompute failed:', recomputeError.message);
  }

  const { data, error } = await supabase
    .from('student_engagement_summary')
    .select('total_login_count, total_time_spent_seconds, last_login_at')
    .eq('student_id', studentId)
    .maybeSingle();

  if (error) throw error;

  if (data) {
    return mergeMetrics(
      {
        total_login_count: data.total_login_count ?? 0,
        total_time_spent_seconds: data.total_time_spent_seconds ?? 0,
        last_login_at: data.last_login_at ?? null,
      },
      aggregate,
    );
  }

  return aggregate;
}

export function useStudentEngagementMetrics(studentId: string | undefined | null) {
  const query = useQuery({
    queryKey: ['student-engagement-metrics', studentId],
    queryFn: () => fetchEngagementMetrics(studentId!),
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
    metrics: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}
