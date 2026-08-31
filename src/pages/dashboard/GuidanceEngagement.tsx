import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, Search, Shield } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EngagementBadge } from '@/components/EngagementBadge';
import { StudentEngagementPanel } from '@/components/StudentEngagementPanel';
import { GuidanceEngagementReferralButton } from '@/components/GuidanceEngagementReferralButton';
import { formatLastLogin, formatTimeSpent } from '@/lib/engagement-format';
import {
  buildGuidanceEngagementRows,
  type GuidanceEngagementRow,
  type GuidanceStudentProfile,
} from '@/lib/guidance-engagement';

/**
 * Guidance counselors: campus-wide read-only engagement view.
 * No instructor actions (send reminder, etc.) — panel omits them for this role.
 */
export default function GuidanceEngagement() {
  const { role } = useAuth();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<GuidanceEngagementRow | null>(null);

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ['guidance-engagement-readonly'],
    queryFn: async (): Promise<GuidanceEngagementRow[]> => {
      const { data: summaries, error: summaryError } = await supabase
        .from('student_engagement_summary')
        .select(
          'student_id, engagement_level, engagement_score, total_login_count, total_time_spent_seconds, last_login_at',
        );
      if (summaryError) throw summaryError;

      const studentIds = [...new Set((summaries ?? []).map((s) => s.student_id))];
      const { data: profiles } = studentIds.length
        ? await supabase
            .from('profiles')
            .select('user_id, full_name, email, student_id')
            .in('user_id', studentIds)
        : { data: [] as GuidanceStudentProfile[] };

      return buildGuidanceEngagementRows(summaries ?? [], profiles ?? []);
    },
    enabled: role === 'guidance_counselor',
    refetchInterval: 60_000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [rows, search]);

  if (role && role !== 'guidance_counselor') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="space-y-6 page-section">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" />
          Student Engagement
        </h1>
        <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
          <Shield className="h-3.5 w-3.5" />
          Campus engagement view — open a counseling referral from a student detail when needed.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-destructive">Could not load engagement data. {error.message}</p>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">All Students</CardTitle>
          <div className="relative max-w-sm mt-2">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Logins</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Last Login</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => (
                    <TableRow
                      key={row.studentId}
                      className="cursor-pointer"
                      onClick={() => setSelected(row)}
                    >
                      <TableCell className="font-medium">{row.fullName}</TableCell>
                      <TableCell>
                        <EngagementBadge level={row.engagementLevel} />
                      </TableCell>
                      <TableCell className="tabular-nums">{row.engagementScore}</TableCell>
                      <TableCell className="tabular-nums">{row.totalLogins}</TableCell>
                      <TableCell>{formatTimeSpent(row.totalTime)}</TableCell>
                      <TableCell>{formatLastLogin(row.lastLoginAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6">No students found.</p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected?.fullName ?? 'Student'}</DialogTitle>
            <DialogDescription>
              Engagement detail — you can start a counseling referral from this review.
            </DialogDescription>
          </DialogHeader>
          {selected ? (
            <div className="space-y-4">
              <GuidanceEngagementReferralButton
                studentId={selected.studentId}
                studentName={selected.fullName}
                engagementLevel={selected.engagementLevel}
                engagementScore={selected.engagementScore}
              />
              <StudentEngagementPanel
                studentId={selected.studentId}
                studentName={selected.fullName}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
