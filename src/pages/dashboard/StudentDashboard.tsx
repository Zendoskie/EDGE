import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BookOpen, CalendarCheck, BarChart3, Brain, Sparkles, Bell, ChevronDown } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { RiskBadge } from '@/components/RiskBadge';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  filterAttendanceBySubjectIds,
  filterPredictionsBySubjectIds,
  filterSubmissionsByActiveSubjects,
  pickLatestPredictionByCreatedAt,
  resolveStudentRiskSummary,
} from '@/lib/student-performance-scope';
import { useCounselingReferrals } from '@/hooks/useCounselingReferrals';
import { CounselingReferralsCard } from '@/components/CounselingReferralsCard';
import { StudentEngagementCard } from '@/components/StudentEngagementCard';
import { formatAssessmentTypeLabel } from '@/lib/assessment-types';
import { useTrackPageView } from '@/hooks/useActivityTracker';
import { useStudentEnrolledSubjectIds } from '@/hooks/useStudentEnrolledSubjectIds';

interface StudentStats {
  enrolledSubjects: number;
  attendanceRate: string;
  overallAverage: string;
  riskStatus: string;
  riskLevel: string | null;
  recommendation: string | null;
  subjectLabel: string | null;
  riskSource: 'prediction' | 'derived';
  riskScore: number | null;
}

interface RecentActivity {
  score: number | null;
  graded_at: string | null;
  activity_id: string;
  assessment_type: string | null;
  activities: {
    id: string;
    title: string;
    type: string;
    max_score: number;
    subjects: {
      code: string;
    };
  };
}

export default function StudentDashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  useTrackPageView('view_subject_page', null, 'Student dashboard');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [selectedReasons, setSelectedReasons] = useState<Record<string, boolean>>({});
  const [details, setDetails] = useState("");
  const [feedbackSubjectId, setFeedbackSubjectId] = useState<string | null>(null);

  const { data: counselingReferrals = [], isLoading: referralsLoading } = useCounselingReferrals();
  const { data: enrolledSubjectIds = [] } = useStudentEnrolledSubjectIds(user?.id);
  const enrolledSubjectIdSet = useMemo(() => new Set(enrolledSubjectIds), [enrolledSubjectIds]);

  const { data: studentProgram } = useQuery({
    queryKey: ['student-program', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('student_programs')
        .select('program_id, year_level, is_irregular, programs(code, name)')
        .eq('student_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data as {
        program_id: string | null;
        year_level: number | null;
        is_irregular: boolean | null;
        programs?: { code?: string | null; name?: string | null } | null;
      } | null;
    },
    enabled: !!user?.id,
  });

  const programCode = studentProgram?.programs?.code ?? undefined;
  const yearSectionLabel = studentProgram?.is_irregular
    ? 'Irregular Student'
    : studentProgram?.year_level != null && programCode
      ? `${programCode}${studentProgram.year_level}`
      : studentProgram?.year_level != null
        ? `Year ${studentProgram.year_level}`
        : undefined;

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['student-dashboard-stats', user?.id, enrolledSubjectIds],
    queryFn: async () => {
      const subjectIds = enrolledSubjectIds;
      const enrolledCount = subjectIds.length;
      const subjectSet = enrolledSubjectIdSet;

      if (enrolledCount === 0) {
        return {
          enrolledSubjects: 0,
          attendanceRate: '—',
          overallAverage: '—',
          riskStatus: '—',
          riskLevel: null,
          recommendation: null,
          subjectLabel: null,
          riskSource: 'derived' as const,
          riskScore: null,
        };
      }

      const { data: attRecordsRaw } = await supabase
        .from('attendance')
        .select('status, subject_id')
        .eq('student_id', user!.id);
      const attRecords = filterAttendanceBySubjectIds(attRecordsRaw ?? [], subjectSet);
      const total = attRecords.length;
      const present = attRecords.filter((a) => a.status === 'present' || a.status === 'late').length;
      const attendanceRateNum = total > 0 ? Math.round((present / total) * 100) : null;

      const { data: subsRaw } = await supabase
        .from('submissions')
        .select('score, activities(max_score, subject_id)')
        .eq('student_id', user!.id);
      const subs = filterSubmissionsByActiveSubjects(subsRaw ?? [], subjectSet);
      let overallAvg: number | null = null;
      if (subs.length) {
        const weighted: number[] = [];
        subs.forEach((s: any) => {
          const act = s.activities;
          const max = act && typeof act === 'object' && 'max_score' in act ? act.max_score : 100;
          if (s.score != null && max) weighted.push((Number(s.score) / Number(max)) * 100);
        });
        overallAvg = weighted.length ? Math.round(weighted.reduce((a, b) => a + b, 0) / weighted.length) : null;
      }

      const { data: predsRaw } = await supabase
        .from('predictions')
        .select('risk_level, risk_score, recommendation, created_at, subject_id, subjects(code, name)')
        .eq('student_id', user!.id)
        .order('created_at', { ascending: false });
      const predsScoped = filterPredictionsBySubjectIds(predsRaw ?? [], subjectSet);
      const pred = pickLatestPredictionByCreatedAt(predsScoped);

      const summary = resolveStudentRiskSummary({
        overallAveragePercent: overallAvg,
        attendanceRatePercent: attendanceRateNum,
        latestPrediction: pred
          ? {
              risk_level: pred.risk_level,
              created_at: pred.created_at,
              recommendation: (pred as { recommendation?: string | null }).recommendation ?? null,
              subjects: (pred as { subjects?: { code?: string; name?: string | null } | null }).subjects ?? null,
            }
          : null,
      });

      return {
        enrolledSubjects: enrolledCount,
        attendanceRate: attendanceRateNum != null ? `${attendanceRateNum}%` : '—',
        overallAverage: overallAvg != null ? `${overallAvg}%` : '—',
        riskStatus: summary.riskStatusLabel,
        riskLevel: summary.resolvedLevel,
        recommendation: summary.recommendation,
        subjectLabel: summary.subjectLabel,
        riskSource: summary.riskSource,
        riskScore:
          pred?.risk_score != null && Number.isFinite(Number(pred.risk_score))
            ? Number(pred.risk_score)
            : null,
      };
    },
    enabled: !!user?.id,
  });

  const { data: recentActivity = [], isLoading: activityLoading } = useQuery({
    queryKey: ['student-recent-activity', user?.id, enrolledSubjectIds],
    queryFn: async () => {
      if (enrolledSubjectIds.length === 0) return [];
      const subjectSet = enrolledSubjectIdSet;
      const { data: subs } = await supabase
        .from('submissions')
        .select('score, graded_at, activity_id, assessment_type, activities(id, title, type, max_score, subject_id, subjects(code, name))')
        .eq('student_id', user!.id)
        .order('graded_at', { ascending: false })
        .limit(40);
      return filterSubmissionsByActiveSubjects(subs ?? [], subjectSet).slice(0, 5);
    },
    enabled: !!user?.id,
  });

  const { data: atRiskSubjects = [] } = useQuery({
    queryKey: ["student-at-risk-subjects", user?.id, enrolledSubjectIds],
    queryFn: async () => {
      if (!user?.id) return [];
      const subjectIds = enrolledSubjectIds;
      if (subjectIds.length === 0) return [];
      const subjectSet = enrolledSubjectIdSet;
      const { data, error } = await supabase
        .from("predictions")
        .select("id, subject_id, risk_level, created_at, subjects(code, name)")
        .eq("student_id", user.id)
        .in("subject_id", subjectIds)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      const latestBySubject = new Map<string, any>();
      for (const row of filterPredictionsBySubjectIds(data ?? [], subjectSet)) {
        if (!row.subject_id) continue;
        if (!latestBySubject.has(row.subject_id)) latestBySubject.set(row.subject_id, row);
      }
      return Array.from(latestBySubject.values()).filter(
        (p: any) => p.risk_level === "critical" || p.risk_level === "at_risk",
      );
    },
    enabled: !!user?.id,
  });

  const { data: latestGradeBySubject = {} } = useQuery<Record<string, string>>({
    queryKey: ["student-latest-grade-by-subject", user?.id, enrolledSubjectIds],
    queryFn: async () => {
      if (!user?.id) return {};
      const subjectSet = enrolledSubjectIdSet;
      if (subjectSet.size === 0) return {};
      const { data, error } = await supabase
        .from("submissions")
        .select("id, graded_at, submitted_at, activities(subject_id)")
        .eq("student_id", user.id)
        .not("score", "is", null)
        .order("graded_at", { ascending: false, nullsFirst: false })
        .order("submitted_at", { ascending: false, nullsFirst: false })
        .limit(300);
      if (error) return {};
      const latest: Record<string, string> = {};
      for (const row of data ?? []) {
        const sid = (row as any)?.activities?.subject_id;
        if (typeof sid !== "string" || !subjectSet.has(sid)) continue;
        if (latest[sid]) continue;
        const t = (row as any)?.graded_at ?? (row as any)?.submitted_at ?? null;
        if (typeof t === "string" && t) latest[sid] = t;
      }
      return latest;
    },
    enabled: !!user?.id,
  });

  const { data: feedbackHistory = [] } = useQuery({
    queryKey: ["student-feedback-history", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("student_feedback")
        .select("id, subject_id, created_at")
        .eq("student_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) return [];
      return data ?? [];
    },
    enabled: !!user?.id,
  });

  const needsFeedback = useMemo(() => {
    const lastBySubject = new Map<string, string>();
    for (const row of feedbackHistory as any[]) {
      if (typeof row?.subject_id !== "string") continue;
      if (!lastBySubject.has(row.subject_id)) lastBySubject.set(row.subject_id, String(row.created_at ?? ""));
    }
    return (atRiskSubjects as any[]).filter((p: any) => {
      const subjectId = p.subject_id;
      if (!subjectId) return false;
      const lastGrade = (latestGradeBySubject as any)[subjectId] as string | undefined;
      if (!lastGrade) return false; // only ask after at least one graded submission exists
      const last = lastBySubject.get(subjectId);
      if (!last) return true;
      const gradeTs = Date.parse(lastGrade);
      const lastTs = Date.parse(last);
      if (!Number.isFinite(lastTs)) return true;
      if (Number.isFinite(gradeTs) && gradeTs > lastTs) return true; // new grades since last feedback
      // Cooldown: if no new grades, don't spam the student
      return Date.now() - lastTs > 14 * 24 * 60 * 60 * 1000;
    });
  }, [atRiskSubjects, feedbackHistory, latestGradeBySubject]);

  const reasonOptions = [
    "Inadequate preparation (poor study habits/time management)",
    "Lack of motivation",
    "Fear of failure",
    "External pressures (work/family/financial/health)",
    "Difficulty understanding lessons/content",
    "Missed classes / attendance issues",
    "Missing or late submissions",
    "Other",
  ];

  const feedbackTarget = useMemo(() => {
    if (!needsFeedback.length) return null;
    const preferred = feedbackSubjectId
      ? (needsFeedback as any[]).find((p: any) => p.subject_id === feedbackSubjectId) ?? null
      : null;
    return preferred ?? needsFeedback[0] ?? null;
  }, [needsFeedback, feedbackSubjectId]);
  // Show feedback when at least one subject is currently Crucial/Vulnerable (per-subject prediction)
  // and the student has recent graded activity for that subject.
  const showFeedbackPrompt = !!feedbackTarget;

  const feedbackSubjectLabel = (p: any) => {
    const subj = p?.subjects as any;
    const code = subj?.code ?? "Subject";
    const name = subj?.name ? ` — ${subj.name}` : "";
    const level = p?.risk_level === "critical" ? "Crucial" : "Vulnerable";
    return `${code}${name} (${level})`;
  };

  const feedbackMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Missing session");
      if (!feedbackTarget?.subject_id) throw new Error("Missing subject");
      const reasons = reasonOptions.filter((r) => selectedReasons[r]);
      if (reasons.length === 0) throw new Error("Select at least one reason.");
      const { error } = await supabase.from("student_feedback").insert({
        student_id: user.id,
        subject_id: feedbackTarget.subject_id,
        prediction_id: feedbackTarget.id,
        risk_level: feedbackTarget.risk_level,
        reasons,
        details: details.trim() ? details.trim() : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Feedback submitted. Thank you.");
      setFeedbackOpen(false);
      setSelectedReasons({});
      setDetails("");
      setFeedbackSubjectId(null);
      queryClient.invalidateQueries({ queryKey: ["student-feedback-history", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statCards = [
    { title: 'Subjects', value: stats?.enrolledSubjects ?? '—', icon: BookOpen, color: 'text-primary' },
    { title: 'Attendance', value: stats?.attendanceRate ?? '—', icon: CalendarCheck, color: 'text-success' },
    { title: 'Average', value: stats?.overallAverage ?? '—', icon: BarChart3, color: 'text-accent-foreground' },
    { title: 'Risk', value: stats?.riskStatus ?? '—', icon: Brain, color: 'text-muted-foreground' },
  ];

  const feedbackDialog = showFeedbackPrompt ? (
    <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Give feedback</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Why do you think this happened?</DialogTitle>
          <DialogDescription>
            Select the reasons that best describe your situation. This will be visible to your instructor and guidance counselor.
          </DialogDescription>
        </DialogHeader>
        {needsFeedback.length > 1 ? (
          <div className="space-y-2">
            <Label>Subject</Label>
            <Select
              value={feedbackTarget?.subject_id ?? ""}
              onValueChange={(v) => {
                setFeedbackSubjectId(v);
                setSelectedReasons({});
                setDetails("");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(needsFeedback as any[]).map((p: any) => (
                  <SelectItem key={p.subject_id} value={p.subject_id}>
                    {feedbackSubjectLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="space-y-3">
          {reasonOptions.map((r) => (
            <div key={r} className="flex items-start gap-2">
              <Checkbox
                id={`reason-${r}`}
                checked={!!selectedReasons[r]}
                onCheckedChange={(v) => setSelectedReasons((prev) => ({ ...prev, [r]: !!v }))}
              />
              <Label htmlFor={`reason-${r}`} className="text-sm font-normal cursor-pointer">
                {r}
              </Label>
            </div>
          ))}
        </div>
        <div className="space-y-2 mt-2">
          <Label>Details (optional)</Label>
          <Textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Anything else your instructor should know?"
            className="min-h-[90px]"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setFeedbackOpen(false)}>Cancel</Button>
          <Button onClick={() => feedbackMutation.mutate()} disabled={feedbackMutation.isPending}>
            {feedbackMutation.isPending ? "Submitting..." : "Submit feedback"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  ) : null;

  return (
    <div className="space-y-4 animate-fade-in min-w-0">
      <section className="page-section overflow-hidden">
        <div className="page-section-header flex flex-wrap items-start justify-between gap-3 bg-gradient-to-r from-card via-card to-primary/5">
          <div className="min-w-0">
            <h1 className="text-xl font-display font-bold sm:text-2xl">Student Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Academic overview, grades, and engagement</p>
          </div>
          {(programCode || yearSectionLabel) && (
            <div className="flex flex-wrap gap-2 text-xs sm:text-sm">
              {programCode && !studentProgram?.is_irregular && (
                <Badge variant="outline" className="font-normal">
                  {programCode}
                  {studentProgram?.programs?.name ? ` · ${studentProgram.programs.name}` : ''}
                </Badge>
              )}
              {yearSectionLabel && (
                <Badge variant="secondary" className="font-normal">
                  {yearSectionLabel}
                </Badge>
              )}
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {statsLoading
          ? Array.from({ length: 4 }).map((_, index) => (
              <Card key={`stats-skeleton-${index}`} className="bg-card/90">
                <CardContent className="p-3 sm:p-4">
                  <Skeleton className="h-3 w-2/3 mb-2" />
                  <Skeleton className="h-7 w-16" />
                </CardContent>
              </Card>
            ))
          : statCards.map((stat) => (
              <Card key={stat.title} className="bg-card/90 interactive-lift">
                <CardContent className="flex items-center justify-between gap-2 p-3 sm:p-4">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground truncate">{stat.title}</p>
                    <p className="text-xl sm:text-2xl font-bold truncate">{stat.value}</p>
                  </div>
                  <stat.icon className={`h-4 w-4 sm:h-5 sm:w-5 shrink-0 ${stat.color}`} />
                </CardContent>
              </Card>
            ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="bg-card/90 border-border/70 lg:col-span-2">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="h-4 w-4" />
              Risk overview
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {statsLoading ? (
              <Skeleton className="h-8 w-40" />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {stats?.riskLevel ? (
                    <RiskBadge level={stats.riskLevel} score={stats.riskScore} />
                  ) : (
                    <span className="text-sm text-muted-foreground">No risk classification yet</span>
                  )}
                  {stats?.riskSource === 'prediction' ? (
                    <Badge variant="outline" className="text-xs">Risk Analysis</Badge>
                  ) : stats?.riskSource === 'derived' && stats?.enrolledSubjects ? (
                    <Badge variant="outline" className="text-xs">Pending analysis</Badge>
                  ) : null}
                </div>
                {stats?.subjectLabel ? (
                  <p className="text-sm text-muted-foreground">
                    Latest subject: <span className="font-medium text-foreground">{stats.subjectLabel}</span>
                  </p>
                ) : null}
                {stats?.recommendation ? (
                  <p className="text-sm text-muted-foreground line-clamp-3">{stats.recommendation}</p>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/90 border-border/70">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-base">Quick links</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 flex flex-col gap-2">
            <Button variant="outline" size="sm" className="justify-start" asChild>
              <Link to="/dashboard/learning-assistant">
                <Sparkles className="h-4 w-4 mr-2" />
                AI Coaching
              </Link>
            </Button>
            <Button variant="outline" size="sm" className="justify-start" asChild>
              <Link to="/dashboard/my-scores">
                <BarChart3 className="h-4 w-4 mr-2" />
                View grades
              </Link>
            </Button>
            <Button variant="outline" size="sm" className="justify-start" asChild>
              <Link to="/dashboard/my-engagement">
                <CalendarCheck className="h-4 w-4 mr-2" />
                My engagement
              </Link>
            </Button>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 pt-1">
              <Bell className="h-3.5 w-3.5 shrink-0" />
              Notifications appear in the header inbox.
            </p>
          </CardContent>
        </Card>
      </div>

      {showFeedbackPrompt ? (
        <Card className="bg-card/90 border-primary/30 border-l-4">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">Feedback requested</p>
              <p className="text-sm text-muted-foreground">
                You are{" "}
                <span className="font-medium text-foreground">
                  {feedbackTarget.risk_level === "critical" ? "Crucial" : "Vulnerable"}
                </span>{" "}
                in {(feedbackTarget.subjects as any)?.code ?? "a subject"}. Help your instructor understand why.
              </p>
              {needsFeedback.length > 1 ? (
                <Select
                  value={feedbackTarget?.subject_id ?? ""}
                  onValueChange={(v) => {
                    setFeedbackSubjectId(v);
                    setSelectedReasons({});
                    setDetails("");
                  }}
                >
                  <SelectTrigger className="mt-1 h-8 max-w-xs text-xs">
                    <SelectValue placeholder="Choose subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {(needsFeedback as any[]).map((p: any) => (
                      <SelectItem key={p.subject_id} value={p.subject_id}>
                        {feedbackSubjectLabel(p)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
            {feedbackDialog}
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="activity" className="w-full min-w-0">
        <TabsList className="grid w-full grid-cols-2 h-auto sm:h-10">
          <TabsTrigger value="activity" className="text-xs sm:text-sm">Activity & engagement</TabsTrigger>
          <TabsTrigger value="support" className="text-xs sm:text-sm">Referrals & help</TabsTrigger>
        </TabsList>

        <TabsContent value="activity" className="mt-3 space-y-3">
          <div className="grid gap-3 lg:grid-cols-2">
            <StudentEngagementCard compact />
            <Card className="bg-card/90">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2 pt-4 px-4">
                <CardTitle className="text-base">Recent grades</CardTitle>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/dashboard/my-scores">All scores</Link>
                </Button>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {activityLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <Skeleton key={`activity-skeleton-${index}`} className="h-8 w-full" />
                    ))}
                  </div>
                ) : recentActivity.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No graded activity yet.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm max-h-[280px] overflow-y-auto pr-1">
                    {recentActivity.map((s) => {
                      const act = s.activities;
                      const subj = act?.subjects;
                      const maxScore = act?.max_score ?? 100;
                      return (
                        <li key={s.activity_id ?? s.graded_at} className="flex items-center justify-between gap-2 py-1 border-b border-border/50 last:border-0">
                          <div className="min-w-0">
                            <span className="truncate block">{subj?.code ?? '—'} — {act?.title ?? 'Activity'}</span>
                            {s.assessment_type ? (
                              <p className="text-xs text-muted-foreground truncate">{formatAssessmentTypeLabel(s.assessment_type)}</p>
                            ) : null}
                          </div>
                          <Badge variant="secondary" className="shrink-0">
                            {s.score != null ? `${Math.round((Number(s.score) / Number(maxScore)) * 100)}%` : '—'}
                          </Badge>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="support" className="mt-3 space-y-3">
          <CounselingReferralsCard
            referrals={counselingReferrals}
            loading={referralsLoading}
            compact
            showInstructor
            title="Counseling referrals"
            description="Track whether your guidance counseling referrals are pending, approved, or rejected."
          />

          <Collapsible>
            <Card className="bg-card/90 border-border/70">
              <CollapsibleTrigger asChild>
                <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors rounded-lg">
                  <span className="text-sm font-medium">How scores and risk are calculated</span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0 text-sm text-muted-foreground space-y-2 border-t border-border/50">
                  <p>
                    Activity percentages are computed as <span className="font-medium text-foreground">(score / max score) x 100</span>.
                  </p>
                  <p>
                    For each subject, your instructor can configure a grading system that must total 100%:
                    Activity + Project + Attendance + Exam (midterm + finals). Your weighted result follows those course-specific percentages.
                  </p>
                  <p>
                    Risk level is inferred from attendance, graded outputs, and completion patterns from predictions.
                    Consistently low weighted performance across subjects increases Vulnerable/Crucial status.
                  </p>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </TabsContent>
      </Tabs>
    </div>
  );
}
