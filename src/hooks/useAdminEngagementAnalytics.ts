import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  canonicalEngagementLevel,
  engagementLabel,
} from '@/lib/engagement-utils';
import { formatLastLogin, formatTimeSpent } from '@/lib/engagement-format';

export type AdminStudentEngagementRow = {
  student_id: string;
  full_name: string;
  email: string | null;
  program_name: string;
  engagement_level: string;
  engagement_score: number;
  total_login_count: number;
  total_time_spent_seconds: number;
  last_login_at: string | null;
  assignments_submitted: number;
  ai_sessions: number;
  feedback_count: number;
};

export type AdminEngagementAnalytics = {
  rows: AdminStudentEngagementRow[];
  activeInactive: { name: string; value: number; key: string }[];
  byProgram: { program: string; avgScore: number; students: number }[];
  monthlyTrend: { month: string; avgScore: number; logins: number; activeStudents: number }[];
  noActivity: AdminStudentEngagementRow[];
  mostActive: AdminStudentEngagementRow[];
  lowestEngagement: AdminStudentEngagementRow[];
};

const NO_ACTIVITY_DAYS = 7;

function monthKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-PH', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

async function fetchAllSummaries() {
  const pageSize = 1000;
  const rows: {
    student_id: string;
    engagement_level: string;
    engagement_score: number | null;
    total_login_count: number | null;
    total_time_spent_seconds: number | null;
    last_login_at: string | null;
    assignments_submitted: number | null;
    ai_sessions: number | null;
    feedback_count: number | null;
  }[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('student_engagement_summary')
      .select(
        'student_id, engagement_level, engagement_score, total_login_count, total_time_spent_seconds, last_login_at, assignments_submitted, ai_sessions, feedback_count',
      )
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }

  return rows;
}

export function useAdminEngagementAnalytics(enabled: boolean) {
  const query = useQuery({
    queryKey: ['admin-engagement-analytics'],
    queryFn: async (): Promise<AdminEngagementAnalytics> => {
      const { data: studentRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'student');
      if (rolesError) throw rolesError;
      const studentIds = [...new Set((studentRoles ?? []).map((r) => r.user_id).filter(Boolean))];

      const summaries = await fetchAllSummaries();
      const summaryById = new Map(summaries.map((s) => [s.student_id, s]));

      const idsForProfiles = studentIds.length > 0 ? studentIds : summaries.map((s) => s.student_id);

      const [{ data: profiles }, { data: studentPrograms }, { data: programs }] = await Promise.all([
        idsForProfiles.length
          ? supabase
              .from('profiles')
              .select('user_id, full_name, email')
              .in('user_id', idsForProfiles)
          : Promise.resolve({ data: [] as { user_id: string; full_name: string | null; email: string | null }[] }),
        idsForProfiles.length
          ? supabase
              .from('student_programs')
              .select('student_id, program_id')
              .in('student_id', idsForProfiles)
          : Promise.resolve({ data: [] as { student_id: string; program_id: string | null }[] }),
        supabase.from('programs').select('id, name, code'),
      ]);

      const programNameById = new Map(
        (programs ?? []).map((p) => [p.id, (p.name || p.code || 'Program').trim()]),
      );
      const programByStudent = new Map<string, string>();
      for (const sp of studentPrograms ?? []) {
        if (!sp.program_id) continue;
        programByStudent.set(sp.student_id, programNameById.get(sp.program_id) || 'Unassigned');
      }

      const profileById = new Map(
        (profiles ?? []).map((p) => [
          p.user_id,
          { full_name: p.full_name?.trim() || 'Student', email: p.email ?? null },
        ]),
      );

      const targetIds =
        studentIds.length > 0
          ? studentIds
          : [...new Set([...summaryById.keys(), ...profileById.keys()])];

      const rows: AdminStudentEngagementRow[] = targetIds.map((studentId) => {
        const summary = summaryById.get(studentId);
        const profile = profileById.get(studentId);
        return {
          student_id: studentId,
          full_name: profile?.full_name ?? 'Student',
          email: profile?.email ?? null,
          program_name: programByStudent.get(studentId) ?? 'Unassigned',
          engagement_level: summary?.engagement_level ?? 'low',
          engagement_score: Number(summary?.engagement_score ?? 0),
          total_login_count: summary?.total_login_count ?? 0,
          total_time_spent_seconds: summary?.total_time_spent_seconds ?? 0,
          last_login_at: summary?.last_login_at ?? null,
          assignments_submitted: summary?.assignments_submitted ?? 0,
          ai_sessions: summary?.ai_sessions ?? 0,
          feedback_count: summary?.feedback_count ?? 0,
        };
      });

      let active = 0;
      let inactive = 0;
      for (const row of rows) {
        const level = canonicalEngagementLevel(row.engagement_level);
        if (level === 'high' || level === 'very_high') active += 1;
        else inactive += 1;
      }

      const programBuckets = new Map<string, { total: number; count: number }>();
      for (const row of rows) {
        const key = row.program_name || 'Unassigned';
        const bucket = programBuckets.get(key) ?? { total: 0, count: 0 };
        bucket.total += row.engagement_score;
        bucket.count += 1;
        programBuckets.set(key, bucket);
      }
      const byProgram = [...programBuckets.entries()]
        .map(([program, bucket]) => ({
          program,
          avgScore: bucket.count ? Math.round((bucket.total / bucket.count) * 10) / 10 : 0,
          students: bucket.count,
        }))
        .sort((a, b) => b.avgScore - a.avgScore);

      const since = new Date();
      since.setUTCMonth(since.getUTCMonth() - 11);
      since.setUTCDate(1);
      since.setUTCHours(0, 0, 0, 0);

      const { data: logins, error: loginError } = await supabase
        .from('student_login_history')
        .select('student_id, login_time')
        .gte('login_time', since.toISOString())
        .eq('counts_as_login', true);
      if (loginError) throw loginError;

      const scoreByStudent = new Map(rows.map((r) => [r.student_id, r.engagement_score]));
      const monthStats = new Map<
        string,
        { logins: number; students: Set<string>; scoreTotal: number }
      >();

      for (let i = 0; i < 12; i++) {
        const d = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + i, 1));
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        monthStats.set(key, { logins: 0, students: new Set(), scoreTotal: 0 });
      }

      for (const login of logins ?? []) {
        if (!login.login_time || !login.student_id) continue;
        const key = monthKey(login.login_time);
        const bucket = monthStats.get(key);
        if (!bucket) continue;
        bucket.logins += 1;
        if (!bucket.students.has(login.student_id)) {
          bucket.students.add(login.student_id);
          bucket.scoreTotal += scoreByStudent.get(login.student_id) ?? 0;
        }
      }

      const monthlyTrend = [...monthStats.entries()].map(([key, bucket]) => ({
        month: monthLabel(key),
        avgScore:
          bucket.students.size > 0
            ? Math.round((bucket.scoreTotal / bucket.students.size) * 10) / 10
            : 0,
        logins: bucket.logins,
        activeStudents: bucket.students.size,
      }));

      const cutoff = Date.now() - NO_ACTIVITY_DAYS * 24 * 60 * 60 * 1000;
      const noActivity = rows
        .filter((row) => {
          if (!row.last_login_at) return true;
          return Date.parse(row.last_login_at) < cutoff;
        })
        .sort((a, b) => a.engagement_score - b.engagement_score);

      const mostActive = [...rows]
        .sort((a, b) => b.engagement_score - a.engagement_score || b.total_login_count - a.total_login_count)
        .slice(0, 10);

      const lowestEngagement = [...rows]
        .sort((a, b) => a.engagement_score - b.engagement_score || a.total_login_count - b.total_login_count)
        .slice(0, 10);

      return {
        rows,
        activeInactive: [
          { name: 'Active', value: active, key: 'active' },
          { name: 'Inactive', value: inactive, key: 'inactive' },
        ],
        byProgram,
        monthlyTrend,
        noActivity,
        mostActive,
        lowestEngagement,
      };
    },
    enabled,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const exportRows = useMemo(() => {
    const data = query.data;
    if (!data) return [];
    return data.rows.map((row) => ({
      'Student Name': row.full_name,
      Email: row.email ?? '',
      Program: row.program_name,
      'Engagement Level': engagementLabel(canonicalEngagementLevel(row.engagement_level)),
      'Engagement Score': row.engagement_score,
      'Total Logins': row.total_login_count,
      'Total Time Spent': formatTimeSpent(row.total_time_spent_seconds),
      'Last Login': formatLastLogin(row.last_login_at),
      'Assignments Completed': row.assignments_submitted,
      'AI Sessions': row.ai_sessions,
      'Feedback Submitted': row.feedback_count,
    }));
  }, [query.data]);

  return {
    data: query.data ?? null,
    exportRows,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
