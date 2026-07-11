import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { EngagementBadge } from '@/components/EngagementBadge';
import { Activity, LogIn, BookOpen, Megaphone, FileText, ClipboardCheck } from 'lucide-react';

type EngagementSummary = {
  engagement_level: string;
  engagement_score: number;
  total_login_count: number;
  last_login_at: string | null;
  participation_count: number;
  modules_viewed: number;
  announcements_read: number;
  assignments_submitted: number;
  quiz_attempts: number;
};

export function StudentEngagementCard() {
  const { user } = useAuth();

  const { data: summary, isLoading } = useQuery({
    queryKey: ['student-engagement-summary', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_engagement_summary')
        .select('*')
        .eq('student_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as EngagementSummary | null;
    },
    enabled: !!user?.id,
    refetchOnWindowFocus: true,
  });

  const score = summary?.engagement_score ?? 0;

  return (
    <Card className="bg-card/90 border-border/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Activity className="h-5 w-5" />
          My Engagement
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : !summary ? (
          <p className="text-sm text-muted-foreground">
            Your engagement level will appear here as you use the system — log in, view courses, and complete activities.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <EngagementBadge level={summary.engagement_level} score={summary.engagement_score} />
              <span className="text-sm text-muted-foreground">Overall engagement</span>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Engagement progress</span>
                <span>{Number(score).toFixed(0)}%</span>
              </div>
              <Progress value={Math.min(100, Number(score))} className="h-2" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1">
                  <LogIn className="h-3.5 w-3.5" />
                  Logins
                </div>
                <p className="font-semibold tabular-nums">{summary.total_login_count}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Last: {summary.last_login_at ? new Date(summary.last_login_at).toLocaleString() : '—'}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1">
                  <Activity className="h-3.5 w-3.5" />
                  Activities
                </div>
                <p className="font-semibold tabular-nums">{summary.participation_count}</p>
              </div>
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1">
                  <BookOpen className="h-3.5 w-3.5" />
                  Modules
                </div>
                <p className="font-semibold tabular-nums">{summary.modules_viewed}</p>
              </div>
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1">
                  <Megaphone className="h-3.5 w-3.5" />
                  Announcements
                </div>
                <p className="font-semibold tabular-nums">{summary.announcements_read}</p>
              </div>
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1">
                  <FileText className="h-3.5 w-3.5" />
                  Assignments
                </div>
                <p className="font-semibold tabular-nums">{summary.assignments_submitted}</p>
              </div>
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1">
                  <ClipboardCheck className="h-3.5 w-3.5" />
                  Quiz attempts
                </div>
                <p className="font-semibold tabular-nums">{summary.quiz_attempts}</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
