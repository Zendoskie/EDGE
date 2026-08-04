import { Navigate } from 'react-router-dom';
import { Activity, Clock, LogIn, MessageSquare, Bot, FileCheck, Gauge } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useStudentEngagementSummary } from '@/hooks/useStudentEngagementSummary';
import { StudentEngagementCharts } from '@/components/StudentEngagementCharts';
import { EngagementBadge } from '@/components/EngagementBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatLastLogin, formatTimeSpent } from '@/lib/engagement-format';
import { useTrackPageView } from '@/hooks/useActivityTracker';

export default function MyEngagement() {
  const { user, role } = useAuth();
  // Always the authenticated user — students cannot request another student's id.
  const studentId = role === 'student' ? user?.id : undefined;
  const { summary, isLoading, error } = useStudentEngagementSummary(studentId);

  useTrackPageView('page_visit', null, 'My Engagement page');

  // Students may only view their own engagement data.
  if (role && role !== 'student') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="space-y-6 page-section">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" />
          My Engagement
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your personal engagement metrics and trend. Only you can see this page.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-destructive">Could not load engagement data. {error.message}</p>
      ) : null}

      <Card className="bg-card/90 border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary" />
            Engagement Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border p-3 space-y-1">
                <p className="text-xs text-muted-foreground">Engagement Level</p>
                <EngagementBadge level={summary?.engagement_level ?? 'low'} />
              </div>
              <div className="rounded-lg border p-3 space-y-1">
                <p className="text-xs text-muted-foreground">Engagement Score</p>
                <p className="text-2xl font-semibold tabular-nums">
                  {summary != null ? Math.round(summary.engagement_score * 10) / 10 : '—'}
                </p>
              </div>
              <div className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <LogIn className="h-3.5 w-3.5" />
                  Total Logins
                </div>
                <p className="text-2xl font-semibold tabular-nums">{summary?.total_login_count ?? 0}</p>
              </div>
              <div className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  Total Time Spent
                </div>
                <p className="text-lg font-semibold leading-snug">
                  {formatTimeSpent(summary?.total_time_spent_seconds)}
                </p>
              </div>
              <div className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <LogIn className="h-3.5 w-3.5" />
                  Last Login
                </div>
                <p className="text-sm font-medium">{formatLastLogin(summary?.last_login_at)}</p>
              </div>
              <div className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FileCheck className="h-3.5 w-3.5" />
                  Assignments Completed
                </div>
                <p className="text-2xl font-semibold tabular-nums">
                  {summary?.assignments_submitted ?? 0}
                </p>
              </div>
              <div className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Bot className="h-3.5 w-3.5" />
                  AI Sessions
                </div>
                <p className="text-2xl font-semibold tabular-nums">{summary?.ai_sessions ?? 0}</p>
              </div>
              <div className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MessageSquare className="h-3.5 w-3.5" />
                  Feedback Submitted
                </div>
                <p className="text-2xl font-semibold tabular-nums">{summary?.feedback_count ?? 0}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {studentId ? (
        <div className="space-y-2">
          <h2 className="text-lg font-medium">Personal Engagement Trend</h2>
          <StudentEngagementCharts studentId={studentId} />
        </div>
      ) : (
        <Skeleton className="h-[280px] w-full" />
      )}
    </div>
  );
}
