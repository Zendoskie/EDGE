import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, BookOpen, Brain, AlertTriangle, AlertOctagon, GraduationCap, Calendar, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Bar, BarChart, XAxis, YAxis, CartesianGrid, Cell } from 'recharts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';

const riskLabel = (level: string) => {
  if (level === 'critical') return 'Critical';
  if (level === 'at_risk') return 'At Risk';
  if (level === 'excelling') return 'Excelling';
  return 'Stable';
};

const riskVariant = (level: string): 'destructive' | 'default' | 'secondary' => {
  if (level === 'critical' || level === 'at_risk') return 'destructive';
  if (level === 'excelling') return 'default';
  return 'secondary';
};

const getYearFromSubject = (subject: any) => {
  const code = subject.code || '';
  const yearMatch = code.match(/(\d+)/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1]);
    if (year >= 1 && year <= 4) return year;
  }
  return 1; // Default to year 1 if no year found
};

const riskSeverity = (level: string) => {
  if (level === 'critical') return 3;
  if (level === 'at_risk') return 2;
  if (level === 'stable') return 1;
  return 0;
};

function alignTrendWithRisk(
  trend: 'improved' | 'declined' | 'stable',
  latestRisk: string,
): 'improved' | 'declined' | 'stable' {
  // Guardrails for clearer instructor interpretation:
  // - Critical cannot be tagged as improved.
  // - Stable/Excelling cannot be tagged as declined.
  // "Improved" at at-risk is allowed when graded work/recovery clearly supports it (see activity merge).
  if (latestRisk === 'critical') return 'declined';
  if (latestRisk === 'stable' || latestRisk === 'excelling') {
    return trend === 'declined' ? 'stable' : trend;
  }
  return trend;
}

/** Trends from graded submissions + recent attendance vs prior window (scores sorted newest-first). */
function inferActivityTrend(
  scoreHistory: Array<{ pct: number; ts: number }>,
  attendanceStatuses: string[],
): 'improved' | 'declined' | 'stable' {
  const recentScores = scoreHistory.slice(0, 3).map((s) => s.pct);
  const olderScores = scoreHistory.slice(3, 6).map((s) => s.pct);
  const recentScoreAvg = recentScores.length ? recentScores.reduce((a, b) => a + b, 0) / recentScores.length : null;
  const olderScoreAvg = olderScores.length ? olderScores.reduce((a, b) => a + b, 0) / olderScores.length : null;

  const recentAttendance = attendanceStatuses.slice(0, 5);
  const olderAttendance = attendanceStatuses.slice(5, 10);
  const attendanceRate = (list: string[]) =>
    list.length === 0
      ? null
      : (list.filter((s) => s === 'present' || s === 'late').length / list.length) * 100;
  const recentAttendanceRate = attendanceRate(recentAttendance);
  const olderAttendanceRate = attendanceRate(olderAttendance);

  const signals: Array<'improved' | 'declined'> = [];
  if (recentScoreAvg != null && olderScoreAvg != null) {
    if (recentScoreAvg - olderScoreAvg >= 5) signals.push('improved');
    if (olderScoreAvg - recentScoreAvg >= 5) signals.push('declined');
  }

  // New / thin history: recent graded work stands alone — avoid "nothing changed" falsely mapping to declining.
  if (recentScores.length >= 1 && olderScores.length === 0 && recentScoreAvg != null && recentScoreAvg >= 85) {
    signals.push('improved');
  }

  if (recentAttendanceRate != null && olderAttendanceRate != null) {
    if (recentAttendanceRate - olderAttendanceRate >= 10) signals.push('improved');
    if (olderAttendanceRate - recentAttendanceRate >= 10) signals.push('declined');
  }

  const hasDeclined = signals.includes('declined');
  const hasImproved = signals.includes('improved');
  if (hasDeclined && hasImproved) {
    if (recentScoreAvg != null && olderScoreAvg != null) {
      const diff = recentScoreAvg - olderScoreAvg;
      if (Math.abs(diff) >= 5) return diff > 0 ? 'improved' : 'declined';
      return 'stable';
    }
    if (recentScores.length >= 1 && olderScores.length === 0 && recentScoreAvg != null && recentScoreAvg >= 85) {
      return 'improved';
    }
    return 'stable';
  }
  if (hasDeclined) return 'declined';
  if (hasImproved) return 'improved';
  return 'stable';
}

export default function InstructorDashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: subjectsWithPrograms } = useQuery({
    queryKey: ['instructor-subjects-programs', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subjects')
        .select(`
          id, 
          name, 
          code, 
          semester, 
          academic_year,
          program_id,
          programs(id, code, name)
        `)
        .eq('instructor_id', user!.id)
        .order('code');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.id,
  });

  const { data: stats } = useQuery({
    queryKey: ['instructor-dashboard-stats', user?.id],
    queryFn: async () => {
      const subjectIds = subjectsWithPrograms?.map(s => s.id) ?? [];
      if (subjectIds.length === 0) {
        return { totalStudents: 0, activeSubjects: 0, predictionsRun: 0, atRiskStudents: 0, criticalStudents: 0 };
      }
      const [enrollmentsRes, predictionsRes] = await Promise.all([
        supabase.from('enrollments').select('student_id, status').in('subject_id', subjectIds),
        supabase.from('predictions').select('id, risk_level').in('subject_id', subjectIds),
      ]);
      const activeStudents = (enrollmentsRes.data ?? []).filter(e => e.status === 'active');
      const uniqueStudents = new Set(activeStudents.map(e => e.student_id) ?? []).size;
      const pendingCount = (enrollmentsRes.data ?? []).filter(e => e.status === 'pending').length;
      const atRisk = predictionsRes.data?.filter(p => p.risk_level === 'at_risk').length ?? 0;
      const critical = predictionsRes.data?.filter(p => p.risk_level === 'critical').length ?? 0;
      return {
        totalStudents: uniqueStudents,
        activeSubjects: subjectIds.length,
        predictionsRun: predictionsRes.data?.length ?? 0,
        atRiskStudents: atRisk,
        criticalStudents: critical,
        pendingEnrollments: pendingCount,
      };
    },
    enabled: !!user?.id && !!subjectsWithPrograms,
  });

  const { data: analyticsData } = useQuery({
    queryKey: ['instructor-analytics', user?.id],
    queryFn: async () => {
      const ids = subjectsWithPrograms?.map(s => s.id) ?? [];
      if (ids.length === 0) return { chartData: [], byProgram: [], needIntervention: [] };
      const { data: predictions } = await supabase
        .from('predictions')
        .select('id, risk_level, subject_id, student_id, subjects(id, code, name)')
        .in('subject_id', ids);
      const preds = predictions ?? [];
      const criticalAndAtRisk = preds.filter((p: any) => p.risk_level === 'critical' || p.risk_level === 'at_risk');
      const chartData = [
        { level: 'Critical', count: preds.filter((p: any) => p.risk_level === 'critical').length, fill: 'hsl(0 72% 51%)' },
        { level: 'At Risk', count: preds.filter((p: any) => p.risk_level === 'at_risk').length, fill: 'hsl(38 92% 50%)' },
        { level: 'Stable', count: preds.filter((p: any) => p.risk_level === 'stable').length, fill: 'hsl(215 15% 50%)' },
        { level: 'Excelling', count: preds.filter((p: any) => p.risk_level === 'excelling').length, fill: 'hsl(215 65% 36%)' },
      ];
      const programCount: Record<string, number> = {};
      const programMeta: Record<string, { code: string; name?: string | null }> = {};
      for (const s of subjectsWithPrograms ?? []) {
        const p = (s as any).programs;
        const code = p?.code ?? 'Unassigned';
        programCount[code] = (programCount[code] ?? 0) + 1;
        if (!programMeta[code]) {
          programMeta[code] = { code, name: p?.name };
        }
      }
      const byProgram = Object.entries(programCount).map(([code, count]) => {
        const meta = programMeta[code];
        const label = meta?.name ? `${code} — ${meta.name}` : code;
        return { code, label, count };
      });
      return { chartData: chartData.filter(d => d.count > 0), byProgram, needIntervention: criticalAndAtRisk };
    },
    enabled: !!user?.id && !!subjectsWithPrograms,
  });

  const { data: recentPredictions = [] } = useQuery({
    queryKey: ['instructor-recent-predictions', user?.id],
    queryFn: async () => {
      const ids = subjectsWithPrograms?.map(s => s.id) ?? [];
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from('predictions')
        .select('id, risk_level, recommendation, subject_id, subjects(code, name)')
        .in('subject_id', ids)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.id && !!subjectsWithPrograms,
  });

  const { data: monitoringRows = [], isError: monitoringIsError, error: monitoringError } = useQuery({
    queryKey: ['instructor-monitoring-rows', user?.id],
    queryFn: async () => {
      const ids = subjectsWithPrograms?.map((s) => s.id) ?? [];
      if (ids.length === 0) return [];

      const { data: enrollments, error: enrollmentsError } = await supabase
        .from('enrollments')
        .select('student_id, subject_id, status')
        .in('subject_id', ids)
        .eq('status', 'active');
      if (enrollmentsError) throw enrollmentsError;
      const enrollmentRows = enrollments ?? [];
      if (enrollmentRows.length === 0) return [];

        const { data: predictions, error } = await supabase
        .from('predictions')
        .select('id, student_id, subject_id, risk_level, attendance_rate, quiz_average, assignment_average, project_score, created_at, subjects(code, name)')
        .in('subject_id', ids)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const predRows = predictions ?? [];

      const { data: attendanceRows, error: attendanceError } = await supabase
        .from('attendance')
        .select('student_id, subject_id, status, date')
        .in('subject_id', ids)
        .order('date', { ascending: false });
      if (attendanceError) throw attendanceError;

      const studentIds = Array.from(
        new Set(enrollmentRows.map((e: any) => e.student_id).filter((id: unknown): id is string => typeof id === 'string')),
      );

      const { data: submissionRows, error: submissionsError } = await supabase
        .from('submissions')
        .select('student_id, score, graded_at, submitted_at, activities(subject_id, max_score)')
        .in('student_id', studentIds);
      if (submissionsError) throw submissionsError;
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name, email, student_id')
        .in('user_id', studentIds);
      const profileByStudentId = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));

      const grouped = new Map<string, any[]>();
      for (const row of predRows) {
        const key = `${row.student_id}::${row.subject_id}`;
        const existing = grouped.get(key) ?? [];
        existing.push(row);
        grouped.set(key, existing);
      }

      const subjectById = new Map((subjectsWithPrograms ?? []).map((s: any) => [s.id, s]));
      const attendanceByKey = new Map<string, Array<{ status: string; date: string | null }>>();
      for (const row of attendanceRows ?? []) {
        if (typeof row?.student_id !== 'string' || typeof row?.subject_id !== 'string') continue;
        const key = `${row.student_id}::${row.subject_id}`;
        const existing = attendanceByKey.get(key) ?? [];
        existing.push({ status: String(row.status ?? ''), date: row.date ?? null });
        attendanceByKey.set(key, existing);
      }

      const scoresByKey = new Map<string, Array<{ pct: number; ts: number }>>();
      for (const row of submissionRows ?? []) {
        const activity = row?.activities as any;
        const subjectId = activity?.subject_id;
        const studentId = row?.student_id;
        const score = row?.score;
        const max = Number(activity?.max_score ?? 0);
        if (typeof studentId !== 'string' || typeof subjectId !== 'string') continue;
        if (score == null || !Number.isFinite(max) || max <= 0) continue;
        const pct = (Number(score) / max) * 100;
        if (!Number.isFinite(pct)) continue;
        const tsRaw = row?.graded_at ?? row?.submitted_at ?? null;
        const ts = tsRaw ? Date.parse(String(tsRaw)) : 0;
        const key = `${studentId}::${subjectId}`;
        const existing = scoresByKey.get(key) ?? [];
        existing.push({ pct, ts: Number.isFinite(ts) ? ts : 0 });
        scoresByKey.set(key, existing);
      }
      for (const [key, values] of scoresByKey.entries()) {
        values.sort((a, b) => b.ts - a.ts);
        scoresByKey.set(key, values);
      }

      return enrollmentRows.map((enroll: any) => {
        const key = `${enroll.student_id}::${enroll.subject_id}`;
        const history = grouped.get(key) ?? [];
        const latest = history[0] ?? null;
        const previous = history[1] ?? null;
        const subject = subjectById.get(enroll.subject_id);
        const latestRisk = latest?.risk_level ?? 'stable';
        const scoreHistorySorted = scoresByKey.get(key) ?? [];
        const attendanceStatusesOrdered = (attendanceByKey.get(key) ?? []).map((a: { status: string }) => a.status);

        let trend: 'improved' | 'declined' | 'stable' = 'stable';

        const previousRisk = previous?.risk_level ?? latestRisk;

        const riskDelta = riskSeverity(latestRisk) - riskSeverity(previousRisk);
        if (previous) {
          if (riskDelta < 0) trend = 'improved';
          if (riskDelta > 0) trend = 'declined';
        }

        const latestScores = [latest?.quiz_average, latest?.assignment_average, latest?.project_score]
          .filter((v: any) => typeof v === 'number' && Number.isFinite(v)) as number[];
        const latestScoreAvgPred = latestScores.length > 0
          ? latestScores.reduce((a, b) => a + b, 0) / latestScores.length
          : 0;
        const previousScoreAvgPred = previous
          ? (() => {
              const prevScores = [previous?.quiz_average, previous?.assignment_average, previous?.project_score]
                .filter((v: any) => typeof v === 'number' && Number.isFinite(v)) as number[];
              return prevScores.length > 0 ? prevScores.reduce((a, b) => a + b, 0) / prevScores.length : 0;
            })()
          : latestScoreAvgPred;

        // Refinement from rolling prediction aggregates when risk delta was flat or missing.
        if (trend === 'stable' && previous) {
          if (latestScoreAvgPred - previousScoreAvgPred >= 5) trend = 'improved';
          if (previousScoreAvgPred - latestScoreAvgPred >= 5) trend = 'declined';
        }

        const activityTrend = inferActivityTrend(scoreHistorySorted, attendanceStatusesOrdered);
        const predictionTs = latest?.created_at ? Date.parse(String(latest.created_at)) : Number.NaN;
        const newestGradeTs = scoreHistorySorted[0]?.ts ?? 0;
        const hasFreshGradedWork =
          newestGradeTs > 0 && Number.isFinite(predictionTs) && newestGradeTs > predictionTs;

        if (!previous) {
          trend = activityTrend;
        } else {
          // Prefer real graded submissions when newer than last prediction snapshot (risk row lags grading).
          if (hasFreshGradedWork && activityTrend !== 'stable') {
            trend = activityTrend;
          } else if (activityTrend === 'improved' && trend === 'declined') {
            trend = 'improved';
          }
        }

        trend = alignTrendWithRisk(trend, latestRisk);

        const attendanceHistoryAll = (attendanceByKey.get(key) ?? []).map((a) => a.status);
        const attendanceRateAll =
          attendanceHistoryAll.length === 0
            ? null
            : (attendanceHistoryAll.filter((s) => s === 'present' || s === 'late').length / attendanceHistoryAll.length) * 100;
        const attendancePct = latest?.attendance_rate != null
          ? Math.round(Number(latest.attendance_rate) * 100)
          : attendanceRateAll != null
            ? Math.round(attendanceRateAll)
            : null;
        const subjectCode = (latest?.subjects as any)?.code ?? subject?.code ?? '—';
        const subjectName = (latest?.subjects as any)?.name ?? subject?.name ?? 'Subject';
        const profile = profileByStudentId.get(enroll.student_id);

        const scoreHistoryForDisplay = scoresByKey.get(key) ?? [];
        const scoreFromHistory =
          scoreHistoryForDisplay.length > 0
            ? scoreHistoryForDisplay.slice(0, 5).reduce((a, b) => a + b.pct, 0) / Math.min(scoreHistoryForDisplay.length, 5)
            : null;
        const displayScoreAvg =
          latestScoreAvgPred > 0
            ? Math.round(latestScoreAvgPred)
            : scoreFromHistory != null
              ? Math.round(scoreFromHistory)
              : null;

        const reasons: string[] = [];
        if (latestRisk === 'critical' || latestRisk === 'at_risk') reasons.push(`Risk level: ${riskLabel(latestRisk)}`);
        if (attendancePct != null && attendancePct < 75) reasons.push(`Low attendance: ${attendancePct}%`);
        if (displayScoreAvg != null && displayScoreAvg < 70) reasons.push(`Low score average: ${displayScoreAvg}%`);
        if (trend === 'declined') reasons.push('Declining trend detected');

        return {
          key: `${enroll.student_id}-${enroll.subject_id}`,
          studentId: enroll.student_id as string,
          studentName: profile?.full_name || 'Unknown student',
          studentEmail: profile?.email || null,
          studentNo: profile?.student_id || '—',
          subjectId: enroll.subject_id as string,
          subjectCode,
          subjectName,
          latestRisk,
          attendancePct,
          latestScoreAvg: displayScoreAvg,
          trend,
          reasons,
          createdAt: latest?.created_at as string | null,
        };
      });
    },
    enabled: !!user?.id && !!subjectsWithPrograms,
  });

  const trendSummary = useMemo(() => {
    const improved = monitoringRows.filter((r: any) => r.trend === 'improved').length;
    const declined = monitoringRows.filter((r: any) => r.trend === 'declined').length;
    const stable = monitoringRows.filter((r: any) => r.trend === 'stable').length;
    return { improved, declined, stable };
  }, [monitoringRows]);

  const sortedMonitoringRows = useMemo(() => {
    const trendPriority: Record<string, number> = {
      declined: 0,
      stable: 1,
      improved: 2,
    };
    return [...monitoringRows].sort((a: any, b: any) => {
      const riskDelta = riskSeverity(b.latestRisk) - riskSeverity(a.latestRisk);
      if (riskDelta !== 0) return riskDelta;
      const trendDelta = (trendPriority[a.trend] ?? 9) - (trendPriority[b.trend] ?? 9);
      if (trendDelta !== 0) return trendDelta;
      const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
      const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
      return tb - ta;
    });
  }, [monitoringRows]);

  const earlyWarnings = useMemo(
    () => monitoringRows.filter((r: any) => Array.isArray(r.reasons) && r.reasons.length > 0),
    [monitoringRows],
  );

  const { data: earlyWarningHistory = [] } = useQuery({
    queryKey: ['instructor-early-warning-history', user?.id, monitoringRows.length],
    queryFn: async () => {
      const subjectIds = Array.from(
        new Set(
          monitoringRows
            .map((row: any) => row.subjectId)
            .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0),
        ),
      );
      if (subjectIds.length === 0) return [];
      const { data, error } = await supabase
        .from('interventions')
        .select('id, student_id, subject_id, sent_at, message, type, status')
        .in('subject_id', subjectIds)
        .eq('type', 'email')
        .eq('status', 'sent')
        .ilike('message', 'Early warning alert%')
        .order('sent_at', { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.id && monitoringRows.length > 0,
  });

  const earlyWarningByStudentSubject = useMemo(() => {
    const map = new Map<string, { sentAt: string | null }>();
    for (const row of earlyWarningHistory as any[]) {
      if (typeof row?.student_id !== 'string' || typeof row?.subject_id !== 'string') continue;
      const key = `${row.student_id}-${row.subject_id}`;
      if (!map.has(key)) {
        map.set(key, { sentAt: (row?.sent_at as string | null) ?? null });
      }
    }
    return map;
  }, [earlyWarningHistory]);

  const { data: recentStudentFeedback = [] } = useQuery({
    queryKey: ['instructor-student-feedback', user?.id],
    queryFn: async () => {
      const ids = subjectsWithPrograms?.map((s: any) => s.id) ?? [];
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from('student_feedback')
        .select('id, created_at, student_id, subject_id, risk_level, reasons, details')
        .in('subject_id', ids)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      const studentIds = Array.from(new Set((data ?? []).map((r: any) => r.student_id).filter(Boolean)));
      const subjectIds = Array.from(new Set((data ?? []).map((r: any) => r.subject_id).filter(Boolean)));
      const [profilesRes, subjectsRes] = await Promise.all([
        studentIds.length ? supabase.from('profiles').select('user_id, full_name, email, student_id').in('user_id', studentIds) : Promise.resolve({ data: [] as any[] }),
        subjectIds.length ? supabase.from('subjects').select('id, code, name').in('id', subjectIds) : Promise.resolve({ data: [] as any[] }),
      ]);
      const profileMap = new Map((profilesRes.data ?? []).map((p: any) => [p.user_id, p]));
      const subjectMap = new Map((subjectsRes.data ?? []).map((s: any) => [s.id, s]));
      return (data ?? []).map((r: any) => ({
        ...r,
        student: profileMap.get(r.student_id) ?? null,
        subject: subjectMap.get(r.subject_id) ?? null,
      }));
    },
    enabled: !!user?.id && !!subjectsWithPrograms,
  });

  const notifyStudent = useMutation({
    mutationFn: async (row: any) => {
      const message = `Early warning alert for ${row.subjectCode}: ${row.reasons.join('; ')}. Please review your progress and contact your instructor for support.`;
      const { error: interventionError } = await supabase.from('interventions').insert({
        student_id: row.studentId,
        subject_id: row.subjectId,
        type: 'email',
        message,
        status: 'sent',
        sent_at: new Date().toISOString(),
      });
      if (interventionError) throw new Error(interventionError.message || 'Failed to create in-app warning.');

      if (row?.studentEmail) {
        const { error } = await supabase.functions.invoke('send-notification', {
          body: {
            to: row.studentEmail,
            student_id: row.studentId,
            subject_id: row.subjectId,
            risk_level: row.latestRisk,
            subject_code: row.subjectCode,
            subject_name: row.subjectName,
            body: message,
          },
        });
        if (error) {
          throw new Error(`In-app warning saved, but email failed: ${error.message || 'send error'}`);
        }
      }
    },
    onSuccess: () => {
      toast.success('Early warning sent to student account');
      queryClient.invalidateQueries({ queryKey: ['instructor-early-warning-history', user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Group subjects by program and year
  const groupedByProgramAndYear = subjectsWithPrograms?.reduce((acc: Record<string, Record<number, any[]>>, subject) => {
    const programCode = subject.programs?.code || 'Unassigned';
    const year = getYearFromSubject(subject);
    
    if (!acc[programCode]) {
      acc[programCode] = {};
    }
    if (!acc[programCode][year]) {
      acc[programCode][year] = [];
    }
    acc[programCode][year].push(subject);
    return acc;
  }, {}) || {};

  // Get subject stats for each subject
  const { data: subjectStats } = useQuery({
    queryKey: ['subject-stats', user?.id],
    queryFn: async () => {
      const ids = subjectsWithPrograms?.map(s => s.id) ?? [];
      if (ids.length === 0) return {};
      
      const [enrollmentsRes, predictionsRes] = await Promise.all([
        supabase.from('enrollments').select('subject_id, student_id, status').in('subject_id', ids),
        supabase.from('predictions').select('subject_id, risk_level').in('subject_id', ids),
      ]);

      const stats: Record<string, { students: number; atRisk: number; critical: number; predictions: number }> = {};
      
      ids.forEach(id => {
        stats[id] = { students: 0, atRisk: 0, critical: 0, predictions: 0 };
      });

      enrollmentsRes.data?.forEach(enrollment => {
        if (enrollment.status === 'active' && stats[enrollment.subject_id]) {
          stats[enrollment.subject_id].students++;
        }
      });

      predictionsRes.data?.forEach(prediction => {
        if (stats[prediction.subject_id]) {
          stats[prediction.subject_id].predictions++;
          if (prediction.risk_level === 'at_risk') stats[prediction.subject_id].atRisk++;
          if (prediction.risk_level === 'critical') stats[prediction.subject_id].critical++;
        }
      });

      return stats;
    },
    enabled: !!user?.id && !!subjectsWithPrograms,
  });

  const statCards = [
    { title: 'Total Students', value: stats?.totalStudents ?? '—', icon: Users, color: 'text-primary' },
    { title: 'Active Subjects', value: stats?.activeSubjects ?? '—', icon: BookOpen, color: 'text-accent-foreground' },
    { title: 'Predictions Run', value: stats?.predictionsRun ?? '—', icon: Brain, color: 'text-success' },
    { title: 'Pending Requests', value: stats?.pendingEnrollments ?? '0', icon: Calendar, color: 'text-warning-foreground' },
    { title: 'Critical', value: stats?.criticalStudents ?? '—', icon: AlertOctagon, color: 'text-destructive' },
  ];

  const chartConfig = { count: { label: 'Students' }, level: { label: 'Risk Level' } };

  return (
    <div className="space-y-6 animate-fade-in">
      <section className="page-section overflow-hidden">
        <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
          <div>
            <h1 className="text-2xl font-display font-bold">Instructor Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage your courses organized by program and year level</p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.title} className="bg-card/90 interactive-lift">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.title}</CardTitle>
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-card/90 border-border/70">
        <CardHeader>
          <CardTitle className="text-lg">How scores and risk are calculated</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Student percentages are based on <span className="font-medium text-foreground">(score / max score) x 100</span> for each activity.
          </p>
          <p>
            For each subject you own, you can define a 100% grading system:
            Activity %, Project %, Attendance %, and Exam % (midterm + finals combined).
            The system applies these weights when computing weighted course performance.
          </p>
          <p>
            Prediction risk levels use attendance, grade behavior, and completion signals.
            Low weighted performance across these components raises intervention priority.
          </p>
        </CardContent>
      </Card>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-3 h-12">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="courses">Courses by Program</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="bg-card/90 interactive-lift">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Brain className="h-5 w-5" />
                  Risk Distribution
                </CardTitle>
                <p className="text-sm text-muted-foreground">Student risk levels across your subjects</p>
              </CardHeader>
              <CardContent>
                {!analyticsData?.chartData?.length ? (
                  <p className="text-muted-foreground text-sm py-8 text-center">No prediction data yet. Run predictions from a subject page.</p>
                ) : (
                  <ChartContainer config={chartConfig} className="h-[200px] w-full">
                    <BarChart data={analyticsData.chartData} layout="vertical" margin={{ left: 0, right: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" />
                      <YAxis dataKey="level" type="category" width={80} tick={{ fontSize: 12 }} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="count" radius={4}>
                        {analyticsData.chartData.map((entry, index) => (
                          <Cell key={index} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card/90 interactive-lift">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <GraduationCap className="h-5 w-5" />
                  Programs Overview
                </CardTitle>
                <p className="text-sm text-muted-foreground">Your courses across different programs</p>
              </CardHeader>
              <CardContent>
                {!analyticsData?.byProgram?.length ? (
                  <p className="text-muted-foreground text-sm py-8 text-center">No subjects with programs yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {analyticsData.byProgram.map((p: { code: string; label: string; count: number }) => (
                      <Badge key={p.code} variant="secondary" className="text-sm py-1 px-3">
                        {p.label}: {p.count}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6 bg-card/90 interactive-lift">
            <CardHeader>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Student Progress Monitoring
                </CardTitle>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">How trend works</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Trend interpretation</DialogTitle>
                    </DialogHeader>
                    <div className="text-sm text-muted-foreground space-y-2">
                      <p>
                        <span className="font-medium text-foreground">Improved</span>: Risk is getting better, or recent scores/attendance are clearly better than older records.
                      </p>
                      <p>
                        <span className="font-medium text-foreground">Stable</span>: No significant positive or negative movement in risk, attendance, and score indicators.
                      </p>
                      <p>
                        <span className="font-medium text-foreground">Declined</span>: Risk worsened, or recent scores/attendance dropped versus prior records.
                      </p>
                      <p>
                        Trend is constrained for clarity: <span className="font-medium text-foreground">Critical</span> will not show as Improved, and
                        <span className="font-medium text-foreground"> Stable/Excelling</span> will not show as Declined.
                      </p>
                      <p>
                        When you grade work after the last risk run, newer scores are preferred so the panel reflects real progress instead of stale risk snapshots alone.
                      </p>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
              <p className="text-sm text-muted-foreground">
                Combines risk history with graded submissions and attendance recent vs prior windows — recent grades outweigh old risk deltas when grading is newer.
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2 mb-4">
                <Badge variant="default">Improved: {trendSummary.improved}</Badge>
                <Badge variant="secondary">Stable: {trendSummary.stable}</Badge>
                <Badge variant="destructive">Declined: {trendSummary.declined}</Badge>
              </div>
              {monitoringRows.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {monitoringIsError
                    ? `Monitoring failed: ${monitoringError instanceof Error ? monitoringError.message : 'Unknown error'}`
                    : 'No monitoring data yet. Ensure students are actively enrolled and have attendance/score records.'}
                </p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {sortedMonitoringRows.slice(0, 30).map((row: any) => (
                    <div
                      key={row.key}
                      className={`rounded-lg border p-3 ${
                        row.trend === 'declined'
                          ? 'border-destructive/40 bg-destructive/5'
                          : row.trend === 'improved'
                            ? 'border-emerald-500/40 bg-emerald-500/5'
                            : 'border-border/60'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">
                          {row.studentName} ({row.studentNo}) — {row.subjectCode}
                        </p>
                        <div className="flex gap-2">
                          <Badge variant={riskVariant(row.latestRisk)}>Status: {riskLabel(row.latestRisk)}</Badge>
                          <Badge variant={row.trend === 'declined' ? 'destructive' : row.trend === 'improved' ? 'default' : 'secondary'}>
                            Trend: {row.trend}
                          </Badge>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Attendance: {row.attendancePct != null ? `${row.attendancePct}%` : '—'} • Score Avg: {row.latestScoreAvg != null ? `${row.latestScoreAvg}%` : 'No graded metrics yet'}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Last prediction: {row.createdAt ? new Date(row.createdAt).toLocaleString() : 'No prediction yet'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-6 bg-card/90 interactive-lift">
            <CardHeader>
              <CardTitle className="text-lg">Student feedback</CardTitle>
              <p className="text-sm text-muted-foreground">
                Feedback submitted by at-risk/critical students to explain why they are struggling.
              </p>
            </CardHeader>
            <CardContent>
              {recentStudentFeedback.length === 0 ? (
                <p className="text-sm text-muted-foreground">No student feedback submitted yet.</p>
              ) : (
                <div className="space-y-3 max-h-72 overflow-y-auto">
                  {recentStudentFeedback.map((f: any) => (
                    <div key={f.id} className="rounded-xl border border-border/60 p-4 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            {f.student?.full_name ?? f.student?.email ?? f.student_id} — {f.subject?.code ?? f.subject_id}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {f.subject?.name ?? ''} • {f.student?.student_id ?? '—'} • {f.created_at ? new Date(f.created_at).toLocaleString() : ''}
                          </p>
                        </div>
                        <Badge variant={f.risk_level === 'critical' || f.risk_level === 'at_risk' ? 'destructive' : 'secondary'}>
                          {riskLabel(f.risk_level)}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(f.reasons ?? []).slice(0, 6).map((r: string) => (
                          <Badge key={r} variant="outline" className="text-xs">{r}</Badge>
                        ))}
                      </div>
                      {f.details ? <p className="text-sm text-muted-foreground">{f.details}</p> : null}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-6 bg-card/90 interactive-lift">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Early Warning Alerts
              </CardTitle>
              <Badge variant={earlyWarnings.length > 0 ? 'destructive' : 'secondary'}>
                {earlyWarnings.length} active
              </Badge>
            </CardHeader>
            <CardContent>
              {earlyWarnings.length === 0 ? (
                <p className="text-sm text-muted-foreground">No early warning concerns detected from current prediction data.</p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {earlyWarnings.slice(0, 30).map((row: any) => (
                    <div key={`warning-${row.key}`} className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                      {(() => {
                        const sent = earlyWarningByStudentSubject.get(`${row.studentId}-${row.subjectId}`);
                        return sent ? (
                          <div className="mb-2 flex items-center justify-end">
                            <Badge variant="secondary">
                              Notified {sent.sentAt ? new Date(sent.sentAt).toLocaleString() : 'recently'}
                            </Badge>
                          </div>
                        ) : null;
                      })()}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">
                          {row.studentName} — {row.subjectCode}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={notifyStudent.isPending || !row.studentEmail}
                          onClick={() => notifyStudent.mutate(row)}
                        >
                          {row.studentEmail ? 'Notify student' : 'No email'}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {row.reasons.length > 0 ? row.reasons.join(' | ') : 'Performance concern detected.'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {analyticsData?.needIntervention?.length ? (
            <Card className="mt-6 bg-card/90 interactive-lift">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertOctagon className="h-5 w-5 text-destructive" />
                  Interventions Needed
                </CardTitle>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/dashboard/subjects">View Subjects</Link>
                </Button>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">Students with critical or lower scores that may need instructor intervention.</p>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {analyticsData.needIntervention.slice(0, 15).map((p: any) => (
                    <div key={p.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                      <Badge variant={p.risk_level === 'critical' ? 'destructive' : 'outline'}>
                        {riskLabel(p.risk_level)}
                      </Badge>
                      <span className="text-sm truncate flex-1 mx-3">{(p.subjects as any)?.code}</span>
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/dashboard/subjects/${p.subject_id}`}>Intervene</Link>
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card className="mt-6 bg-card/90 interactive-lift">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Recent Predictions</CardTitle>
              <Button variant="outline" size="sm" asChild>
                <Link to="/dashboard/subjects">View Subjects</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {recentPredictions.length === 0 ? (
                <p className="text-muted-foreground text-sm">No predictions have been run yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {recentPredictions.slice(0, 5).map((p: any) => (
                    <li key={p.id} className="flex items-center justify-between py-1 border-b border-border/50 last:border-0">
                      <span>{(p.subjects as any)?.code} — {riskLabel(p.risk_level)}</span>
                      <span className="text-muted-foreground text-xs">{(p.subjects as any)?.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="courses" className="mt-6">
          <div className="space-y-8">
            {Object.entries(groupedByProgramAndYear).map(([programCode, years]) => (
              <Card key={programCode} className="bg-card/90 interactive-lift">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <GraduationCap className="h-5 w-5" />
                    {programCode} Program
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    {Object.entries(years)
                      .sort(([a], [b]) => parseInt(a) - parseInt(b))
                      .map(([year, subjects]) => (
                        <div key={`${programCode}-${year}`} className="border-l-4 border-primary/60 pl-4">
                          <div className="flex items-center gap-2 mb-4">
                            <Badge variant="outline" className="text-lg px-3 py-1">
                              Year {year}
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              {subjects.length} course{subjects.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {subjects.map((subject) => {
                              const stats = subjectStats?.[subject.id] || { students: 0, atRisk: 0, critical: 0, predictions: 0 };
                              return (
                                <Card key={subject.id} className="bg-card/95 hover:shadow-md transition-shadow interactive-lift">
                                  <CardHeader className="pb-3">
                                    <div className="flex items-start justify-between">
                                      <div>
                                        <CardTitle className="text-base">{subject.code}</CardTitle>
                                        <p className="text-sm text-muted-foreground">{subject.name}</p>
                                        <div className="flex items-center gap-2 mt-2">
                                          <Badge variant="outline" className="text-xs">
                                            {subject.semester}
                                          </Badge>
                                          <Badge variant="outline" className="text-xs">
                                            {subject.academic_year}
                                          </Badge>
                                        </div>
                                      </div>
                                    </div>
                                  </CardHeader>
                                  <CardContent className="pt-0">
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between text-sm">
                                        <span className="text-muted-foreground">Students</span>
                                        <span className="font-medium">{stats.students}</span>
                                      </div>
                                      <div className="flex items-center justify-between text-sm">
                                        <span className="text-muted-foreground">Predictions</span>
                                        <span className="font-medium">{stats.predictions}</span>
                                      </div>
                                      {(stats.atRisk > 0 || stats.critical > 0) && (
                                        <div className="flex gap-2 mt-2">
                                          {stats.atRisk > 0 && (
                                            <Badge variant="outline" className="text-xs text-warning-foreground">
                                              {stats.atRisk} At Risk
                                            </Badge>
                                          )}
                                          {stats.critical > 0 && (
                                            <Badge variant="destructive" className="text-xs">
                                              {stats.critical} Critical
                                            </Badge>
                                          )}
                                        </div>
                                      )}
                                      <Button variant="outline" size="sm" className="w-full mt-3" asChild>
                                        <Link to={`/dashboard/subjects/${subject.id}`}>
                                          Manage Course
                                        </Link>
                                      </Button>
                                    </div>
                                  </CardContent>
                                </Card>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            ))}
            {Object.keys(groupedByProgramAndYear).length === 0 && (
              <Card className="bg-card/90 interactive-lift">
                <CardContent className="py-12 text-center">
                  <GraduationCap className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No Courses Assigned</h3>
                  <p className="text-muted-foreground">You haven't been assigned to any courses yet.</p>
                  <Button variant="outline" className="mt-4" asChild>
                    <Link to="/dashboard/subjects">Manage Subjects</Link>
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="analytics" className="mt-6">
          <div className="grid gap-6">
            <Card className="bg-card/90 interactive-lift">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Detailed Analytics
                </CardTitle>
                <p className="text-sm text-muted-foreground">Comprehensive view of your teaching performance</p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.entries(groupedByProgramAndYear).map(([programCode, years]) => (
                    <div key={programCode} className="border rounded-lg p-4">
                      <h4 className="font-medium mb-3">{programCode}</h4>
                      <div className="space-y-2">
                        {Object.entries(years)
                          .sort(([a], [b]) => parseInt(a) - parseInt(b))
                          .map(([year, subjects]) => {
                            const totalStudents = subjects.reduce((sum, s) => 
                              sum + (subjectStats?.[s.id]?.students || 0), 0
                            );
                            const totalAtRisk = subjects.reduce((sum, s) => 
                              sum + (subjectStats?.[s.id]?.atRisk || 0), 0
                            );
                            const totalCritical = subjects.reduce((sum, s) => 
                              sum + (subjectStats?.[s.id]?.critical || 0), 0
                            );
                            
                            return (
                              <div key={`${programCode}-${year}`} className="text-sm">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium">Year {year}</span>
                                  <span className="text-muted-foreground">{subjects.length} courses</span>
                                </div>
                                <div className="flex gap-2 mt-1">
                                  <span className="text-xs text-muted-foreground">
                                    {totalStudents} students
                                  </span>
                                  {(totalAtRisk > 0 || totalCritical > 0) && (
                                    <>
                                      {totalAtRisk > 0 && (
                                        <Badge variant="outline" className="text-xs text-warning-foreground">
                                          {totalAtRisk} at risk
                                        </Badge>
                                      )}
                                      {totalCritical > 0 && (
                                        <Badge variant="destructive" className="text-xs">
                                          {totalCritical} critical
                                        </Badge>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
