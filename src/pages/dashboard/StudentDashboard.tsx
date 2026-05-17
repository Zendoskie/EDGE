import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BookOpen, CalendarCheck, BarChart3, Brain } from 'lucide-react';
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
  fetchActiveEnrolledSubjectIds,
  filterAttendanceBySubjectIds,
  filterPredictionsBySubjectIds,
  filterSubmissionsByActiveSubjects,
  pickLatestPredictionByCreatedAt,
  resolveStudentRiskSummary,
} from '@/lib/student-performance-scope';
import { useCounselingReferrals } from '@/hooks/useCounselingReferrals';
import { CounselingReferralsCard } from '@/components/CounselingReferralsCard';

interface StudentStats {
  enrolledSubjects: number;
  attendanceRate: string;
  overallAverage: string;
  riskStatus: string;
  riskLevel: string | null;
  recommendation: string | null;
  subjectLabel: string | null;
  riskSource: 'prediction' | 'derived';
}

interface RecentActivity {
  score: number | null;
  graded_at: string | null;
  activity_id: string;
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
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [selectedReasons, setSelectedReasons] = useState<Record<string, boolean>>({});
  const [details, setDetails] = useState("");
  const [feedbackSubjectId, setFeedbackSubjectId] = useState<string | null>(null);

  const { data: counselingReferrals = [], isLoading: referralsLoading } = useCounselingReferrals();

  const programCode = (user?.user_metadata as any)?.course as string | undefined;
  const yearLevel = (user?.user_metadata as any)?.year_level as string | undefined;

  const { data: program } = useQuery({
    queryKey: ['student-program', programCode],
    queryFn: async () => {
      if (!programCode) return null;
      const { data, error } = await supabase
        .from('programs')
        .select('code, name')
        .eq('code', programCode)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!programCode,
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['student-dashboard-stats', user?.id],
    queryFn: async () => {
      const subjectIds = await fetchActiveEnrolledSubjectIds(supabase, user!.id);
      const enrolledCount = subjectIds.length;
      const subjectSet = new Set(subjectIds);

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
        .select('risk_level, recommendation, created_at, subject_id, subjects(code, name)')
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
      };
    },
    enabled: !!user?.id,
  });

  const { data: recentActivity = [], isLoading: activityLoading } = useQuery({
    queryKey: ['student-recent-activity', user?.id],
    queryFn: async () => {
      const subjectIds = await fetchActiveEnrolledSubjectIds(supabase, user!.id);
      if (subjectIds.length === 0) return [];
      const subjectSet = new Set(subjectIds);
      const { data: subs } = await supabase
        .from('submissions')
        .select('score, graded_at, activity_id, activities(id, title, type, max_score, subject_id, subjects(code, name))')
        .eq('student_id', user!.id)
        .order('graded_at', { ascending: false })
        .limit(40);
      return filterSubmissionsByActiveSubjects(subs ?? [], subjectSet).slice(0, 5);
    },
    enabled: !!user?.id,
  });

  const { data: atRiskSubjects = [] } = useQuery({
    queryKey: ["student-at-risk-subjects", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const subjectIds = await fetchActiveEnrolledSubjectIds(supabase, user.id);
      if (subjectIds.length === 0) return [];
      const subjectSet = new Set(subjectIds);
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
    queryKey: ["student-latest-grade-by-subject", user?.id],
    queryFn: async () => {
      if (!user?.id) return {};
      const subjectIds = await fetchActiveEnrolledSubjectIds(supabase, user.id);
      const subjectSet = new Set(subjectIds);
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
    { title: 'Enrolled Subjects', value: stats?.enrolledSubjects ?? '—', icon: BookOpen, color: 'text-primary' },
    { title: 'Attendance Rate', value: stats?.attendanceRate ?? '—', icon: CalendarCheck, color: 'text-success' },
    { title: 'Overall Average', value: stats?.overallAverage ?? '—', icon: BarChart3, color: 'text-accent-foreground' },
    { title: 'Risk Status', value: stats?.riskStatus ? `${stats.riskStatus}${stats?.riskSource ? ` (${stats.riskSource === 'prediction' ? 'AI' : 'Current' })` : ''}` : '—', icon: Brain, color: 'text-muted-foreground' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <section className="page-section overflow-hidden">
        <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
          <div>
            <h1 className="text-2xl font-display font-bold">Student Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1">Your academic performance at a glance</p>
          </div>
          {(programCode || yearLevel) && (
            <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-2 text-sm text-muted-foreground">
              {programCode && (
                <div>
                  <span className="font-medium text-foreground">Program:</span>{' '}
                  {program?.code ?? programCode}
                  {program?.name ? ` — ${program.name}` : ''}
                </div>
              )}
              {yearLevel && (
                <div>
                  <span className="font-medium text-foreground">Year level:</span> {yearLevel}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsLoading
          ? Array.from({ length: 4 }).map((_, index) => (
              <Card key={`stats-skeleton-${index}`} className="bg-card/90">
                <CardHeader className="space-y-2 pb-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-8 w-20" />
                </CardHeader>
              </Card>
            ))
          : statCards.map((stat) => (
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

      <CounselingReferralsCard
        referrals={counselingReferrals}
        loading={referralsLoading}
        showInstructor
        title="Counseling referrals"
        description="Track whether your guidance counseling referrals are pending, approved, or rejected."
      />

      <Card className="bg-card/90 border-border/70">
        <CardHeader>
          <CardTitle className="text-lg">How scores and risk are calculated</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
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
      </Card>

      {showFeedbackPrompt ? (
        <Card className="bg-card/90 border-border/70">
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg">Student feedback (requested)</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Your recent grades indicate you are{" "}
                <span className="font-medium text-foreground">
                  {feedbackTarget.risk_level === "critical" ? "Crucial" : "Vulnerable"}
                </span>{" "}
                for{" "}
                <span className="font-medium text-foreground">
                  {(feedbackTarget.subjects as any)?.code ?? "Subject"}
                </span>
                . Share why this happened so your instructor/guidance counselor can support you.
              </p>
              {needsFeedback.length > 1 ? (
                <div className="mt-3 max-w-md">
                  <Label className="text-xs text-muted-foreground">Select subject</Label>
                  <Select
                    value={feedbackTarget?.subject_id ?? ""}
                    onValueChange={(v) => {
                      setFeedbackSubjectId(v);
                      setSelectedReasons({});
                      setDetails("");
                    }}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Choose a subject" />
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
            </div>
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
          </CardHeader>
        </Card>
      ) : null}

      <Card className="bg-card/90">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Recent Activity</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Latest graded submissions and score progress.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/dashboard/my-scores">View Scores</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {activityLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={`activity-skeleton-${index}`} className="h-9 w-full" />
              ))}
            </div>
          ) : recentActivity.length === 0 ? (
            <p className="text-muted-foreground text-sm">No activity yet. Your performance data will appear here once your instructor records grades.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {recentActivity.map((s) => {
                const act = s.activities;
                const subj = act?.subjects;
                const maxScore = act?.max_score ?? 100;
                return (
                  <li key={s.activity_id ?? s.graded_at} className="flex items-center justify-between py-1 border-b border-border/50 last:border-0">
                    <span>{subj?.code ?? '—'} — {act?.title ?? 'Activity'}</span>
                    <Badge variant="secondary">{s.score != null ? `${Math.round((Number(s.score) / Number(maxScore)) * 100)}%` : '—'}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
