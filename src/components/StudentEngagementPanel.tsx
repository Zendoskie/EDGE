import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { EngagementBadge } from '@/components/EngagementBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatActivityTypeLabel } from '@/lib/engagement-utils';
import { LogIn } from 'lucide-react';

type Props = {
  studentId: string;
  subjectId?: string | null;
  studentName?: string | null;
};

type ActivityRow = {
  id: string;
  activity_type: string;
  activity_description: string | null;
  created_at: string;
  subject_id: string | null;
  subjects?: { code?: string | null; name?: string | null } | null;
};

type LoginRow = {
  id: string;
  login_time: string;
};

function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (isToday) return `Today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return d.toLocaleString();
}

export function StudentEngagementPanel({ studentId, subjectId, studentName }: Props) {
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['student-engagement-panel-summary', studentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_engagement_summary')
        .select('*')
        .eq('student_id', studentId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!studentId,
    refetchOnWindowFocus: true,
  });

  const { data: activities = [], isLoading: activitiesLoading } = useQuery({
    queryKey: ['student-engagement-panel-activities', studentId, subjectId],
    queryFn: async () => {
      let q = supabase
        .from('student_activity')
        .select('id, activity_type, activity_description, created_at, subject_id, subjects(code, name)')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(30);
      if (subjectId) {
        q = q.eq('subject_id', subjectId);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ActivityRow[];
    },
    enabled: !!studentId,
  });

  const { data: recentLogins = [] } = useQuery({
    queryKey: ['student-engagement-panel-logins', studentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_login_history')
        .select('id, login_time')
        .eq('student_id', studentId)
        .order('login_time', { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as LoginRow[];
    },
    enabled: !!studentId,
  });

  const { data: subjectActivity = [] } = useQuery({
    queryKey: ['student-engagement-subject-counts', studentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_activity')
        .select('subject_id, subjects(code)')
        .eq('student_id', studentId)
        .not('subject_id', 'is', null);
      if (error) throw error;
      const counts = new Map<string, { code: string; count: number }>();
      for (const row of data ?? []) {
        const sid = row.subject_id as string;
        const code = (row.subjects as { code?: string } | null)?.code ?? 'Unknown';
        const existing = counts.get(sid) ?? { code, count: 0 };
        existing.count += 1;
        counts.set(sid, existing);
      }
      return Array.from(counts.values()).sort((a, b) => b.count - a.count);
    },
    enabled: !!studentId,
  });

  const mostActive = subjectActivity[0];
  const leastActive = subjectActivity.length > 1 ? subjectActivity[subjectActivity.length - 1] : null;

  const recentItems: Array<{ label: string; time: string }> = [];

  for (const login of recentLogins.slice(0, 2)) {
    recentItems.push({ label: 'Logged in', time: login.login_time });
  }

  for (const act of activities.slice(0, 8)) {
    const label =
      act.activity_description?.trim() ||
      formatActivityTypeLabel(act.activity_type);
    recentItems.push({ label, time: act.created_at });
  }

  recentItems.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));

  const loading = summaryLoading || activitiesLoading;

  return (
    <div className="space-y-4">
      {studentName ? (
        <p className="text-sm text-muted-foreground">
          Engagement overview for <span className="font-medium text-foreground">{studentName}</span>
        </p>
      ) : null}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : !summary ? (
        <p className="text-sm text-muted-foreground">
          No engagement data recorded yet for this student.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <EngagementBadge level={summary.engagement_level} score={summary.engagement_score} />
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Total logins</p>
              <p className="font-semibold tabular-nums">{summary.total_login_count}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Last login</p>
              <p className="font-medium">
                {summary.last_login_at
                  ? formatRelativeTime(summary.last_login_at)
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Total activities</p>
              <p className="font-semibold tabular-nums">{summary.participation_count}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Most active subject</p>
              <p className="font-medium">{mostActive ? `${mostActive.code} (${mostActive.count})` : '—'}</p>
            </div>
            <div className="col-span-2">
              <p className="text-muted-foreground text-xs">Least active subject</p>
              <p className="font-medium">
                {leastActive && leastActive !== mostActive
                  ? `${leastActive.code} (${leastActive.count})`
                  : '—'}
              </p>
            </div>
          </div>
        </>
      )}

      <div>
        <p className="text-sm font-medium mb-2">Recent activities</p>
        {recentItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent activity.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {recentItems.slice(0, 10).map((item, i) => (
              <li key={`${item.time}-${i}`} className="flex items-start gap-2 text-muted-foreground">
                {item.label === 'Logged in' ? (
                  <LogIn className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                ) : null}
                <span>
                  <span className="text-foreground">{item.label}</span>
                  <span className="text-xs ml-1">({formatRelativeTime(item.time)})</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
