import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useStudentEngagementMetrics } from '@/hooks/useStudentEngagementMetrics';
import { useStudentEngagementSummary } from '@/hooks/useStudentEngagementSummary';
import { EngagementBadge } from '@/components/EngagementBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Activity, Clock, LogIn, MessageSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatFeedbackStatus, formatLastLogin, formatTimeSpent } from '@/lib/engagement-format';

type FeedbackRow = {
  id: string;
  subject: string | null;
  message: string;
  status: string;
  created_at: string;
};

export function StudentEngagementCard() {
  const { user } = useAuth();
  const { metrics, isLoading, error } = useStudentEngagementMetrics(user?.id);
  const { summary } = useStudentEngagementSummary(user?.id);

  const { data: latestFeedback } = useQuery({
    queryKey: ['student-engagement-feedback-latest', user?.id],
    queryFn: async () => {
      const { data, error: feedbackError } = await supabase
        .from('student_engagement_feedback')
        .select('id, subject, message, status, created_at')
        .eq('student_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (feedbackError) throw feedbackError;
      return data as FeedbackRow | null;
    },
    enabled: !!user?.id,
    refetchOnWindowFocus: true,
  });

  return (
    <Card className="bg-card/90 border-border/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Student Engagement
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">
            Could not load engagement metrics. {error.message}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <EngagementBadge
                level={summary?.engagement_level ?? 'low'}
                score={summary?.engagement_score}
              />
              <span className="text-sm text-muted-foreground">
                Score{' '}
                <span className="font-semibold text-foreground tabular-nums">
                  {summary != null ? Math.round(summary.engagement_score * 10) / 10 : '—'}
                </span>
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 text-sm">
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1">
                <LogIn className="h-3.5 w-3.5" />
                Total Logins
              </div>
              <p className="font-semibold tabular-nums text-lg">{metrics?.total_login_count ?? 0}</p>
            </div>
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1">
                <Clock className="h-3.5 w-3.5" />
                Total Time Spent
              </div>
              <p className="font-semibold text-base leading-snug">
                {formatTimeSpent(metrics?.total_time_spent_seconds)}
              </p>
            </div>
            <div className="rounded-lg border p-3 sm:col-span-1">
              <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1">
                <LogIn className="h-3.5 w-3.5" />
                Last Login
              </div>
              <p className="font-medium text-sm leading-snug">{formatLastLogin(metrics?.last_login_at)}</p>
            </div>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-border/60 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium">Latest Feedback</p>
          </div>
          {latestFeedback ? (
            <>
              <p className="text-sm font-medium">{latestFeedback.subject?.trim() || 'General Feedback'}</p>
              <p className="text-sm text-muted-foreground line-clamp-3">&ldquo;{latestFeedback.message}&rdquo;</p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{formatFeedbackStatus(latestFeedback.status)}</Badge>
                <span>{formatLastLogin(latestFeedback.created_at)}</span>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              You have not submitted feedback yet. Share your learning experience or request assistance.
            </p>
          )}
          <div className="flex flex-wrap gap-2 mt-1">
            <Button asChild variant="outline" size="sm">
              <Link to="/dashboard/my-engagement">View My Engagement</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/dashboard/feedback">View All Feedback</Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
