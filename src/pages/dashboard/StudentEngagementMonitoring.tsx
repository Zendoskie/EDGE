import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Search,
  UserMinus,
  Users,
  Gauge,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { RiskBadge } from '@/components/RiskBadge';
import { StudentEngagementPanel } from '@/components/StudentEngagementPanel';
import { EngagementAlertsQueue } from '@/components/StudentEngagementActions';
import { useInstructorEngagementAlerts } from '@/hooks/useEngagementAlerts';
import {
  ENGAGEMENT_LEVEL_ORDER,
  canonicalEngagementLevel,
  engagementLabel,
  type CanonicalEngagementLevel,
} from '@/lib/engagement-utils';
import { formatLastLogin, formatTimeSpent } from '@/lib/engagement-format';
import {
  canonicalRiskLevel,
  type CanonicalRiskLevel,
} from '@/lib/risk-utils';
import { subscribeEngagementInvalidation } from '@/lib/engagement-cache';

type EngagementRow = {
  studentId: string;
  fullName: string;
  programCode: string;
  programName: string;
  yearLevel: number | null;
  totalLogins: number;
  totalTimeSpentSeconds: number;
  lastLoginAt: string | null;
  engagementScore: number;
  engagementLevel: CanonicalEngagementLevel;
  riskLevel: CanonicalRiskLevel | null;
  riskScore: number | null;
};

type MonitoringPayload = {
  rows: EngagementRow[];
  subjectIds: string[];
};

const RISK_SEVERITY: Record<CanonicalRiskLevel, number> = {
  excelling: 0,
  stable: 1,
  at_risk: 2,
  critical: 3,
};

function formatYearLevel(year: number | null): string {
  if (year == null || !Number.isFinite(year)) return '—';
  return `Year ${year}`;
}

export default function StudentEngagementMonitoring() {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [engagementFilter, setEngagementFilter] = useState<string>('all');
  const [programFilter, setProgramFilter] = useState<string>('all');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [selectedStudent, setSelectedStudent] = useState<{
    studentId: string;
    fullName: string;
  } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['instructor-student-engagement-monitoring', user?.id],
    queryFn: async (): Promise<MonitoringPayload> => {
      const { data: subjects, error: subjectsError } = await supabase
        .from('subjects')
        .select('id')
        .eq('instructor_id', user!.id);
      if (subjectsError) throw subjectsError;

      const subjectIds = (subjects ?? []).map((s) => s.id).filter(Boolean);
      if (subjectIds.length === 0) return { rows: [], subjectIds: [] };

      const { data: enrollments, error: enrollError } = await supabase
        .from('enrollments')
        .select('student_id, subject_id')
        .in('subject_id', subjectIds)
        .eq('status', 'active');
      if (enrollError) throw enrollError;

      const studentIds = [
        ...new Set(
          (enrollments ?? [])
            .map((e) => e.student_id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        ),
      ];
      if (studentIds.length === 0) return { rows: [], subjectIds };

      const [
        { data: profiles, error: profilesError },
        { data: studentPrograms, error: programsError },
        { data: summaries, error: summaryError },
        { data: predictions, error: predictionsError },
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('user_id, full_name')
          .in('user_id', studentIds),
        supabase
          .from('student_programs')
          .select('student_id, year_level, programs(code, name)')
          .in('student_id', studentIds),
        supabase
          .from('student_engagement_summary')
          .select(
            'student_id, engagement_level, engagement_score, total_login_count, total_time_spent_seconds, last_login_at',
          )
          .in('student_id', studentIds),
        supabase
          .from('predictions')
          .select('student_id, subject_id, risk_level, risk_score, created_at')
          .in('subject_id', subjectIds)
          .in('student_id', studentIds)
          .order('created_at', { ascending: false }),
      ]);

      if (profilesError) throw profilesError;
      if (programsError) throw programsError;
      if (summaryError) throw summaryError;
      if (predictionsError) throw predictionsError;

      const profileById = new Map(
        (profiles ?? []).map((p) => [p.user_id, p] as const),
      );
      const programById = new Map(
        (studentPrograms ?? []).map((sp) => [sp.student_id, sp] as const),
      );
      const summaryById = new Map(
        (summaries ?? []).map((s) => [s.student_id, s] as const),
      );

      const activeEnrollmentKeys = new Set(
        (enrollments ?? [])
          .filter((e) => e.student_id && e.subject_id)
          .map((e) => `${e.student_id}::${e.subject_id}`),
      );

      const worstRiskByStudent = new Map<
        string,
        { level: CanonicalRiskLevel; score: number | null }
      >();

      for (const pred of predictions ?? []) {
        if (!pred.student_id || !pred.subject_id) continue;
        if (!activeEnrollmentKeys.has(`${pred.student_id}::${pred.subject_id}`)) continue;

        const level = canonicalRiskLevel(pred.risk_level);
        const score =
          pred.risk_score != null && Number.isFinite(Number(pred.risk_score))
            ? Number(pred.risk_score)
            : null;
        const existing = worstRiskByStudent.get(pred.student_id);
        if (!existing || RISK_SEVERITY[level] > RISK_SEVERITY[existing.level]) {
          worstRiskByStudent.set(pred.student_id, { level, score });
        }
      }

      const mappedRows = studentIds
        .map((studentId): EngagementRow => {
          const profile = profileById.get(studentId);
          const programRow = programById.get(studentId);
          const programs = programRow?.programs as
            | { code?: string | null; name?: string | null }
            | { code?: string | null; name?: string | null }[]
            | null
            | undefined;
          const program = Array.isArray(programs) ? programs[0] : programs;
          const summary = summaryById.get(studentId);
          const risk = worstRiskByStudent.get(studentId);

          return {
            studentId,
            fullName: profile?.full_name?.trim() || 'Unknown student',
            programCode: program?.code?.trim() || '—',
            programName: program?.name?.trim() || '',
            yearLevel:
              programRow?.year_level != null && Number.isFinite(Number(programRow.year_level))
                ? Number(programRow.year_level)
                : null,
            totalLogins: summary?.total_login_count ?? 0,
            totalTimeSpentSeconds: summary?.total_time_spent_seconds ?? 0,
            lastLoginAt: summary?.last_login_at ?? null,
            engagementScore:
              summary?.engagement_score != null && Number.isFinite(Number(summary.engagement_score))
                ? Number(summary.engagement_score)
                : 0,
            engagementLevel: canonicalEngagementLevel(summary?.engagement_level),
            riskLevel: risk?.level ?? null,
            riskScore: risk?.score ?? null,
          };
        })
        .sort((a, b) => a.fullName.localeCompare(b.fullName));

      return { rows: mappedRows, subjectIds };
    },
    enabled: !!user?.id && role === 'instructor',
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    return subscribeEngagementInvalidation(() => {
      void queryClient.invalidateQueries({
        queryKey: ['instructor-student-engagement-monitoring', user?.id],
      });
    });
  }, [queryClient, user?.id]);

  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const instructorSubjectIds = data?.subjectIds ?? [];

  const {
    data: engagementAlerts = [],
    isLoading: alertsLoading,
  } = useInstructorEngagementAlerts(role === 'instructor');

  const studentNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) map.set(row.studentId, row.fullName);
    return map;
  }, [rows]);

  const programOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      if (row.programCode !== '—') {
        map.set(row.programCode, row.programName || row.programCode);
      }
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    for (const row of rows) {
      if (row.yearLevel != null) years.add(row.yearLevel);
    }
    return [...years].sort((a, b) => a - b);
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (q && !row.fullName.toLowerCase().includes(q)) return false;
      if (engagementFilter !== 'all' && row.engagementLevel !== engagementFilter) return false;
      if (programFilter !== 'all' && row.programCode !== programFilter) return false;
      if (yearFilter !== 'all' && String(row.yearLevel ?? '') !== yearFilter) return false;
      return true;
    });
  }, [rows, search, engagementFilter, programFilter, yearFilter]);

  const summary = useMemo(() => {
    const totalActive = rows.length;
    const lowEngagement = rows.filter((r) => r.engagementLevel === 'moderate').length;
    const inactive = rows.filter((r) => r.engagementLevel === 'low').length;
    const avgScore =
      rows.length === 0
        ? 0
        : rows.reduce((sum, r) => sum + r.engagementScore, 0) / rows.length;
    return {
      totalActive,
      lowEngagement,
      inactive,
      avgScore: Math.round(avgScore * 10) / 10,
    };
  }, [rows]);

  if (role && role !== 'instructor') {
    return <Navigate to="/dashboard" replace />;
  }

  const statCards = [
    {
      title: 'Total Active Students',
      value: summary.totalActive,
      icon: Users,
      color: 'text-primary',
    },
    {
      title: 'Low Engagement Students',
      value: summary.lowEngagement,
      icon: AlertTriangle,
      color: 'text-amber-500',
    },
    {
      title: 'Inactive Students',
      value: summary.inactive,
      icon: UserMinus,
      color: 'text-destructive',
    },
    {
      title: 'Average Engagement Score',
      value: summary.avgScore,
      icon: Gauge,
      color: 'text-success',
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in min-w-0">
      <section className="page-section overflow-hidden">
        <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
          <div>
            <h1 className="text-2xl font-display font-bold flex items-center gap-2">
              <Activity className="h-6 w-6 text-primary" />
              Student Engagement Monitoring
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Track login activity, time spent, engagement scores, and risk for students in your subjects.
            </p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 min-w-0">
        {statCards.map((stat) => (
          <Card key={stat.title} className="bg-card/90 interactive-lift">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.title}</CardTitle>
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-9 w-16" />
              ) : (
                <p className="text-3xl font-bold tabular-nums">{stat.value}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-card/90 border-border/70">
        <CardContent className="pt-5">
          <EngagementAlertsQueue
            alerts={engagementAlerts}
            studentNames={studentNames}
            isLoading={alertsLoading}
            onOpenStudent={(studentId, fullName) => setSelectedStudent({ studentId, fullName })}
          />
        </CardContent>
      </Card>

      <Card className="bg-card/90 border-border/70">
        <CardHeader className="space-y-4">
          <div>
            <CardTitle className="text-lg">Engagement roster</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Search and filter enrolled students by engagement level, program, or year level.
              Click a row to view live engagement charts.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by student name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 text-sm"
              />
            </div>
            <Select value={engagementFilter} onValueChange={setEngagementFilter}>
              <SelectTrigger className="h-9 w-[180px] text-sm">
                <SelectValue placeholder="Engagement" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Engagement</SelectItem>
                {ENGAGEMENT_LEVEL_ORDER.map((level) => (
                  <SelectItem key={level} value={level}>
                    {engagementLabel(level)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={programFilter} onValueChange={setProgramFilter}>
              <SelectTrigger className="h-9 w-[160px] text-sm">
                <SelectValue placeholder="Program" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Programs</SelectItem>
                {programOptions.map(([code, name]) => (
                  <SelectItem key={code} value={code}>
                    {code}{name && name !== code ? ` — ${name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={yearFilter} onValueChange={setYearFilter}>
              <SelectTrigger className="h-9 w-[140px] text-sm">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {yearOptions.map((year) => (
                  <SelectItem key={year} value={String(year)}>
                    Year {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : error ? (
            <p className="text-sm text-destructive py-8 text-center">
              Could not load engagement data. {(error as Error).message}
            </p>
          ) : filteredRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {rows.length === 0
                ? 'No actively enrolled students found in your subjects.'
                : 'No students match the current search and filters.'}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student Name</TableHead>
                    <TableHead>Program</TableHead>
                    <TableHead>Year Level</TableHead>
                    <TableHead className="text-right">Total Logins</TableHead>
                    <TableHead>Total Time Spent</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead className="text-right">Engagement Score</TableHead>
                    <TableHead>Engagement Level</TableHead>
                    <TableHead>Current Risk Classification</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((row) => (
                    <TableRow
                      key={row.studentId}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() =>
                        setSelectedStudent({ studentId: row.studentId, fullName: row.fullName })
                      }
                    >
                      <TableCell className="font-medium">{row.fullName}</TableCell>
                      <TableCell>
                        <span className="font-medium">{row.programCode}</span>
                        {row.programName ? (
                          <span className="block text-xs text-muted-foreground">{row.programName}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>{formatYearLevel(row.yearLevel)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.totalLogins}</TableCell>
                      <TableCell>{formatTimeSpent(row.totalTimeSpentSeconds)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatLastLogin(row.lastLoginAt)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {Math.round(row.engagementScore * 10) / 10}
                      </TableCell>
                      <TableCell>
                        <EngagementBadge level={row.engagementLevel} />
                      </TableCell>
                      <TableCell>
                        {row.riskLevel ? (
                          <RiskBadge level={row.riskLevel} score={row.riskScore} />
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {!isLoading && filteredRows.length > 0 && (
            <p className="text-xs text-muted-foreground mt-3">
              Showing {filteredRows.length} of {rows.length} student{rows.length === 1 ? '' : 's'}
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!selectedStudent}
        onOpenChange={(open) => {
          if (!open) setSelectedStudent(null);
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Student Engagement Charts</DialogTitle>
            <DialogDescription>
              Live engagement trend and engagement vs risk timeline for this student.
            </DialogDescription>
          </DialogHeader>
          {selectedStudent ? (
            <StudentEngagementPanel
              studentId={selectedStudent.studentId}
              studentName={selectedStudent.fullName}
              subjectIds={instructorSubjectIds}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
