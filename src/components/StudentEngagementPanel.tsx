import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useStudentEngagementMetrics } from '@/hooks/useStudentEngagementMetrics';
import { useStudentEngagementSummary } from '@/hooks/useStudentEngagementSummary';
import { useStudentParentEngagement } from '@/hooks/useParentEngagement';
import { StudentEngagementCharts } from '@/components/StudentEngagementCharts';
import { StudentEngagementActions } from '@/components/StudentEngagementActions';
import { EngagementBadge } from '@/components/EngagementBadge';
import { EngagementScoreInfo } from '@/components/EngagementScoreInfo';
import { ParentEngagementCard } from '@/components/ParentEngagementCard';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { LogIn, Clock, MessageSquare } from 'lucide-react';
import { formatFeedbackStatus, formatLastLogin, formatTimeSpent } from '@/lib/engagement-format';
import { useAuth } from '@/hooks/useAuth';

type Props = {
  studentId: string;
  studentName?: string | null;
  /** Optional subject scope for risk timeline (instructor subjects). */
  subjectIds?: string[];
};

type FeedbackRow = {
  id: string;
  subject: string | null;
  message: string;
  status: string;
  counselor_remarks: string | null;
  created_at: string;
};

export function StudentEngagementPanel({ studentId, studentName, subjectIds }: Props) {
  const { role } = useAuth();
  const { metrics, isLoading: summaryLoading, error: summaryError } = useStudentEngagementMetrics(studentId);
  const { summary, isLoading: gradeLoading } = useStudentEngagementSummary(studentId);
  const showTimeSpent = role !== 'instructor';
  const canSeeParentEngagement = role === 'instructor' || role === 'admin';
  const {
    summary: parentEngagement,
    isLoading: parentEngagementLoading,
    error: parentEngagementError,
  } = useStudentParentEngagement(studentId, canSeeParentEngagement);

  const { data: profile } = useQuery({
    queryKey: ['engagement-panel-profile', studentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('email, full_name')
        .eq('user_id', studentId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!studentId,
  });

  const { data: feedback = [], isLoading: feedbackLoading } = useQuery({
    queryKey: ['student-engagement-feedback', studentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_engagement_feedback')
        .select('id, subject, message, status, counselor_remarks, created_at')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as FeedbackRow[];
    },
    enabled: !!studentId,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });

  const loading = summaryLoading || feedbackLoading;

  return (
    <div className="space-y-5">
      {studentName ? (
        <p className="text-sm text-muted-foreground">
          Engagement overview for <span className="font-medium text-foreground">{studentName}</span>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {gradeLoading ? (
            <Skeleton className="h-6 w-32" />
          ) : (
            <EngagementBadge
              level={summary?.engagement_level ?? 'low'}
              score={summary?.engagement_score}
            />
          )}
          <span className="text-sm text-muted-foreground">Engagement grade</span>
        </div>
        <EngagementScoreInfo variant="student" />
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : summaryError ? (
        <p className="text-sm text-destructive">
          Could not load engagement metrics. {summaryError.message}
        </p>
      ) : (
        <div className={`grid gap-3 text-sm ${showTimeSpent ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
          <div className="rounded-lg border p-3">
            <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1">
              <LogIn className="h-3.5 w-3.5" />
              Total Logins
            </div>
            <p className="font-semibold tabular-nums text-lg">{metrics?.total_login_count ?? 0}</p>
          </div>
          {showTimeSpent ? (
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1">
                <Clock className="h-3.5 w-3.5" />
                Total Time Spent
              </div>
              <p className="font-semibold">{formatTimeSpent(metrics?.total_time_spent_seconds)}</p>
            </div>
          ) : null}
          <div className="rounded-lg border p-3">
            <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1">
              <LogIn className="h-3.5 w-3.5" />
              Last Login
            </div>
            <p className="font-medium text-sm">{formatLastLogin(metrics?.last_login_at)}</p>
          </div>
        </div>
      )}

      {canSeeParentEngagement ? (
        <ParentEngagementCard
          variant="instructor"
          summary={parentEngagement?.best ?? null}
          parentCount={parentEngagement?.parentCount ?? 0}
          isLoading={parentEngagementLoading}
          error={parentEngagementError}
        />
      ) : null}

      <StudentEngagementCharts studentId={studentId} subjectIds={subjectIds} />

      {role === 'instructor' || role === 'admin' ? (
        <StudentEngagementActions
          studentId={studentId}
          studentEmail={profile?.email}
          subjectId={subjectIds?.[0] ?? null}
        />
      ) : null}

      <div>
        <div className="flex items-center gap-2 mb-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">Student Feedback</p>
        </div>
        {feedback.length === 0 ? (
          <p className="text-sm text-muted-foreground">No feedback submitted by this student yet.</p>
        ) : (
          <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
            {feedback.map((item) => (
              <div key={item.id} className="rounded-lg border border-border/60 p-3 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{item.subject?.trim() || 'General Feedback'}</p>
                  <Badge variant="outline" className="text-xs">{formatFeedbackStatus(item.status)}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{item.message}</p>
                <p className="text-xs text-muted-foreground">{formatLastLogin(item.created_at)}</p>
                {item.counselor_remarks ? (
                  <p className="text-xs text-muted-foreground">
                    Counselor remarks: {item.counselor_remarks}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
