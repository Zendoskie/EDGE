import { Navigate, Link } from 'react-router-dom';
import {
  Activity,
  Clock,
  LogIn,
  MessageSquare,
  Bot,
  FileCheck,
  Gauge,
  Lightbulb,
  Bell,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useStudentEngagementSummary } from '@/hooks/useStudentEngagementSummary';
import { useStudentEngagementAlerts } from '@/hooks/useEngagementAlerts';
import { StudentEngagementCharts } from '@/components/StudentEngagementCharts';
import { StudentImprovementCelebration } from '@/components/StudentImprovementCelebration';
import { AnimatedNumber } from '@/components/motion/AnimatedNumber';
import { EngagementBadge } from '@/components/EngagementBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { formatLastLogin, formatTimeSpent } from '@/lib/engagement-format';
import { buildEngagementNextSteps } from '@/lib/engagement-next-steps';
import { useTrackPageView } from '@/hooks/useActivityTracker';
import { canonicalEngagementLevel } from '@/lib/engagement-utils';

export default function MyEngagement() {
  const { user, role } = useAuth();
  const studentId = role === 'student' ? user?.id : undefined;
  const { summary, isLoading, error } = useStudentEngagementSummary(studentId);
  const { data: alerts = [] } = useStudentEngagementAlerts(studentId);

  useTrackPageView('page_visit', null, 'My Engagement page');

  if (role && role !== 'student') {
    return <Navigate to="/dashboard" replace />;
  }

  const level = canonicalEngagementLevel(summary?.engagement_level);
  const nextSteps = buildEngagementNextSteps(level, summary?.engagement_score ?? null);
  const openNudges = alerts.filter((a) => a.status === 'open' || a.status === 'acknowledged').slice(0, 3);

  return (
    <div className="min-w-0 space-y-6">
      <section className="page-section edge-glass-card overflow-hidden">
        <div className="page-section-header bg-gradient-to-r from-card/80 via-card/70 to-primary/10">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Activity className="h-6 w-6 text-primary" />
              My Engagement
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your personal engagement metrics, gentle reminders, and suggested next steps.
            </p>
          </div>
        </div>
      </section>

      {error ? (
        <p className="text-sm text-destructive">Could not load engagement data. {error.message}</p>
      ) : null}

      {summary && studentId ? (
        <StudentImprovementCelebration
          studentId={studentId}
          currentScore={summary.engagement_score}
          previousScore={summary.previous_engagement_score}
          currentLevel={summary.engagement_level}
          previousLevel={summary.previous_engagement_level}
        />
      ) : null}

      {openNudges.length > 0 ? (
        <Card className="edge-glass-card border-amber-500/25">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="h-4 w-4 text-amber-600" />
              Gentle reminders
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {openNudges.map((alert) => (
              <div key={alert.id} className="rounded-lg border border-border/60 px-3 py-2 text-sm">
                <p className="font-medium">{alert.title || 'Engagement reminder'}</p>
                {alert.message ? (
                  <p className="text-muted-foreground mt-0.5">{alert.message}</p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card className="edge-glass-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-primary" />
            Suggested next steps
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Small actions that can improve your engagement this week.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            nextSteps.map((tip) => (
              <div
                key={tip.title}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border/60 px-3 py-2"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">{tip.title}</p>
                  <p className="text-sm text-muted-foreground">{tip.body}</p>
                </div>
                {tip.href ? (
                  <Button asChild size="sm" variant="outline" className="shrink-0 gap-1">
                    <Link to={tip.href}>
                      {tip.linkLabel ?? 'Open'}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="edge-glass-card">
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
              <div className="edge-metric-card space-y-1 rounded-xl border p-3">
                <p className="text-xs text-muted-foreground">Engagement Level</p>
                <EngagementBadge level={summary?.engagement_level ?? 'low'} />
              </div>
              <div className="edge-metric-card space-y-1 rounded-xl border p-3">
                <p className="text-xs text-muted-foreground">Engagement Score</p>
                <p className="text-2xl font-semibold tabular-nums">
                  {summary != null ? (
                    <AnimatedNumber value={summary.engagement_score} decimals={1} />
                  ) : (
                    '—'
                  )}
                </p>
              </div>
              <div className="edge-metric-card space-y-1 rounded-xl border p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <LogIn className="h-3.5 w-3.5" />
                  Total Logins
                </div>
                <p className="text-2xl font-semibold tabular-nums">
                  <AnimatedNumber value={summary?.total_login_count ?? 0} />
                </p>
              </div>
              <div className="edge-metric-card space-y-1 rounded-xl border p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  Total Time Spent
                </div>
                <p className="text-lg font-semibold leading-snug">
                  {formatTimeSpent(summary?.total_time_spent_seconds)}
                </p>
              </div>
              <div className="edge-metric-card space-y-1 rounded-xl border p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <LogIn className="h-3.5 w-3.5" />
                  Last Login
                </div>
                <p className="text-sm font-medium">{formatLastLogin(summary?.last_login_at)}</p>
              </div>
              <div className="edge-metric-card space-y-1 rounded-xl border p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FileCheck className="h-3.5 w-3.5" />
                  Assignments Completed
                </div>
                <p className="text-2xl font-semibold tabular-nums">
                  <AnimatedNumber value={summary?.assignments_submitted ?? 0} />
                </p>
              </div>
              <div className="edge-metric-card space-y-1 rounded-xl border p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Bot className="h-3.5 w-3.5" />
                  AI Sessions
                </div>
                <p className="text-2xl font-semibold tabular-nums">
                  <AnimatedNumber value={summary?.ai_sessions ?? 0} />
                </p>
              </div>
              <div className="edge-metric-card space-y-1 rounded-xl border p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MessageSquare className="h-3.5 w-3.5" />
                  Feedback Submitted
                </div>
                <p className="text-2xl font-semibold tabular-nums">
                  <AnimatedNumber value={summary?.feedback_count ?? 0} />
                </p>
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
      ) : null}
    </div>
  );
}
