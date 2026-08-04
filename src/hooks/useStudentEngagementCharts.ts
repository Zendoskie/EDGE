import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { subscribeEngagementInvalidation } from '@/lib/engagement-cache';
import {
  buildEngagementTrendSeries,
  type TrendGranularity,
} from '@/lib/engagement-trend';

const PAGE_SIZE = 1000;

async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

export function useStudentEngagementCharts(studentId: string | undefined | null, subjectIds?: string[]) {
  const [granularity, setGranularity] = useState<TrendGranularity>('week');

  const query = useQuery({
    queryKey: [
      'student-engagement-charts',
      studentId,
      subjectIds?.slice().sort().join(',') ?? 'all',
    ],
    queryFn: async () => {
      if (!studentId) {
        return { logins: [], activities: [], feedback: [], risks: [] };
      }

      const [logins, activities, feedback, risks] = await Promise.all([
        fetchAllPages(async (from, to) =>
          supabase
            .from('student_login_history')
            .select('login_time, logout_time, session_duration, counts_as_login')
            .eq('student_id', studentId)
            .order('login_time', { ascending: true })
            .range(from, to),
        ),
        fetchAllPages(async (from, to) =>
          supabase
            .from('student_activity')
            .select('created_at, activity_type')
            .eq('student_id', studentId)
            .order('created_at', { ascending: true })
            .range(from, to),
        ),
        fetchAllPages(async (from, to) =>
          supabase
            .from('student_engagement_feedback')
            .select('created_at')
            .eq('student_id', studentId)
            .order('created_at', { ascending: true })
            .range(from, to),
        ),
        fetchAllPages(async (from, to) => {
          let q = supabase
            .from('predictions')
            .select('created_at, risk_score, subject_id')
            .eq('student_id', studentId)
            .order('created_at', { ascending: true })
            .range(from, to);
          if (subjectIds && subjectIds.length > 0) {
            q = q.in('subject_id', subjectIds);
          }
          return q;
        }),
      ]);

      return { logins, activities, feedback, risks };
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

  const series = useMemo(
    () =>
      buildEngagementTrendSeries({
        logins: query.data?.logins ?? [],
        activities: query.data?.activities ?? [],
        feedback: query.data?.feedback ?? [],
        risks: (query.data?.risks ?? []).map((r) => ({
          created_at: r.created_at,
          risk_score: r.risk_score,
        })),
        granularity,
      }),
    [query.data, granularity],
  );

  return {
    series,
    granularity,
    setGranularity,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
