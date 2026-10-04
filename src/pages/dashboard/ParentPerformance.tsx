import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { canonicalRiskLevel, riskLabel } from '@/lib/risk-utils';
import { RiskBadge } from '@/components/RiskBadge';
import { BookOpen, Calendar, FileText, Activity, ChevronDown } from 'lucide-react';
import { KpiCard } from '@/components/shell/KpiCard';
import { PageHeader } from '@/components/shell/PageHeader';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { averageOf, computeWeightedGrade } from '@/lib/weighted-grading';
import {
  formatAssessmentTypeLabel,
  isCourseworkAssessmentType,
  isExamAssessmentType,
  isProjectAssessmentType,
} from '@/lib/assessment-types';
import { filterSubmissionsByActiveSubjects } from '@/lib/student-performance-scope';
import { AcademicDisclaimer } from '@/components/AcademicDisclaimer';
import { sendParentLinkEmailBestEffort } from '@/lib/invoke-parent-email';
import { parentLinkErrorMessage, parentLinkStatusLabel } from '@/lib/parent-link-status';
import { EngagementBadge } from '@/components/EngagementBadge';
import { formatLastLogin, formatTimeSpent } from '@/lib/engagement-format';
import { canonicalEngagementLevel } from '@/lib/engagement-utils';

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card className="bg-card/90">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}

function relationToObject<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return value as T;
}

function formatSessionDate(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

const attendanceBadgeVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  present: 'default',
  late: 'secondary',
  absent: 'destructive',
  excused: 'outline',
};

function RequestStudentAccessForm({
  initialStudentId = '',
  submitLabel = 'Request Student Access',
  onSubmit,
  isPending,
}: {
  initialStudentId?: string;
  submitLabel?: string;
  onSubmit: (studentIdNo: string) => void;
  isPending: boolean;
}) {
  const [studentIdNo, setStudentIdNo] = useState(initialStudentId);

  return (
    <form
      className="space-y-4 max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(studentIdNo.trim());
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="parent-request-student-id">Student ID</Label>
        <Input
          id="parent-request-student-id"
          value={studentIdNo}
          onChange={(e) => setStudentIdNo(e.target.value)}
          placeholder="23-1-70001"
          required
        />
        <p className="text-xs text-muted-foreground">
          Enter the student&apos;s ID number. The student must approve your request, then an administrator.
        </p>
      </div>
      <Button type="submit" disabled={isPending || !studentIdNo.trim()}>
        {isPending ? 'Submitting...' : submitLabel}
      </Button>
    </form>
  );
}

export default function ParentPerformance() {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();

  const { data: links = [], isLoading: linkLoading } = useQuery({
    queryKey: ['parent-latest-link', user?.id],
    enabled: role === 'parent' && !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('parent_student_links')
        .select('id, student_user_id, student_id_no, status, requested_at')
        .eq('parent_user_id', user!.id)
        .order('requested_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const latestLink = links[0] ?? null;
  // Only a link approved by both the student and an administrator grants access.
  const approvedLink = links.find((l) => l.status === 'approved') ?? null;
  const studentId = approvedLink?.student_user_id ?? null;

  const requestAccess = useMutation({
    mutationFn: async (studentIdNo: string) => {
      if (!user?.id) throw new Error('You must be signed in to request access.');
      const trimmed = studentIdNo.trim();
      if (!trimmed) throw new Error('Student ID is required.');

      const { data: linkId, error } = await supabase.rpc('parent_request_student_link', {
        p_student_id_no: trimmed,
      });
      if (error) throw new Error(parentLinkErrorMessage(error.message));

      if (typeof linkId === 'string' && linkId) {
        sendParentLinkEmailBestEffort({
          type: 'request_received',
          link_id: linkId,
          student_id_no: trimmed,
        });
      }
      return linkId;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['parent-latest-link', user?.id] });
      void queryClient.invalidateQueries({ queryKey: ['parent-approved-link', user?.id] });
      void queryClient.invalidateQueries({ queryKey: ['parent-my-links', user?.id] });
      toast.success('Access request submitted. The student must approve it, then an administrator.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: studentProfile } = useQuery({
    queryKey: ['parent-student-profile', studentId],
    enabled: !!studentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, student_id')
        .eq('user_id', studentId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: enrolledSubjectsRaw = [] } = useQuery({
    queryKey: ['parent-student-enrolled-subjects', studentId],
    enabled: !!studentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enrollments')
        .select('subject_id, subjects(id, code, name), status')
        .eq('student_id', studentId!)
        .eq('status', 'active');
      if (error) throw error;
      return data ?? [];
    },
  });

  const enrolledSubjects = useMemo(() => {
    return (enrolledSubjectsRaw as any[])
      .map((row: any) => {
        const subject = relationToObject<any>(row?.subjects);
        if (!row?.subject_id) return null;
        return {
          subject_id: row.subject_id as string,
          id: (subject?.id as string) || (row.subject_id as string),
          code: (subject?.code as string) || (row.subject_id as string),
          name: (subject?.name as string) || 'Enrolled subject',
        };
      })
      .filter((row): row is { subject_id: string; id: string; code: string; name: string } => row != null);
  }, [enrolledSubjectsRaw]);

  const enrolledSubjectIds = useMemo(
    () =>
      Array.from(
        new Set(
          (enrolledSubjects as any[])
            .map((row: any) => row?.subject_id)
            .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0),
        ),
      ),
    [enrolledSubjects],
  );

  const { data: predictions = [] } = useQuery({
    queryKey: ['parent-student-predictions', studentId, enrolledSubjectIds.join(',')],
    enabled: !!studentId && enrolledSubjectIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('predictions')
        .select('id, subject_id, risk_level, risk_score, recommendation, created_at, subject:subjects!predictions_subject_id_fkey(code,name)')
        .eq('student_id', studentId!)
        .in('subject_id', enrolledSubjectIds)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: engagementSummary } = useQuery({
    queryKey: ['parent-student-engagement', studentId],
    enabled: !!studentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_engagement_summary')
        .select(
          'engagement_level, engagement_score, total_login_count, total_time_spent_seconds, last_login_at, assignments_submitted',
        )
        .eq('student_id', studentId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: predictionInterventions = [] } = useQuery({
    queryKey: ['parent-prediction-interventions', studentId],
    enabled: !!studentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('interventions')
        .select('prediction_id, subject_id')
        .eq('student_id', studentId!)
        .not('prediction_id', 'is', null);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: attendance = [] } = useQuery({
    queryKey: ['parent-student-attendance', studentId, enrolledSubjectIds.join(',')],
    enabled: !!studentId && enrolledSubjectIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attendance')
        .select('subject_id, date, status')
        .eq('student_id', studentId!)
        .in('subject_id', enrolledSubjectIds)
        .order('date', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: activities = [] } = useQuery({
    queryKey: ['parent-student-activities', studentId, enrolledSubjectIds.join(',')],
    enabled: !!studentId && enrolledSubjectIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('activities')
        .select('id, subject_id, title, type, max_score, due_date')
        .in('subject_id', enrolledSubjectIds)
        .order('due_date', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: submissions = [] } = useQuery({
    queryKey: ['parent-student-submissions', studentId, enrolledSubjectIds.join(',')],
    enabled: !!studentId && enrolledSubjectIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('submissions')
        .select('activity_id, score, assessment_type, submitted_at, graded_at, activities(subject_id)')
        .eq('student_id', studentId!);
      if (error) throw error;
      const set = new Set(enrolledSubjectIds);
      return filterSubmissionsByActiveSubjects(data ?? [], set);
    },
  });

  const { data: gradingSystems = [] } = useQuery({
    queryKey: ['parent-student-grading-systems', studentId, enrolledSubjectIds.join(',')],
    enabled: !!studentId && enrolledSubjectIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subject_grading_systems')
        .select('subject_id, activity_weight, project_weight, attendance_weight, exam_weight')
        .in('subject_id', enrolledSubjectIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const allSubjectIdsKey = useMemo(() => {
    const set = new Set<string>();
    for (const s of enrolledSubjects) {
      if (typeof s.id === 'string') set.add(s.id);
      if (typeof s.subject_id === 'string') set.add(s.subject_id);
    }
    for (const a of attendance as any[]) {
      if (typeof a?.subject_id === 'string') set.add(a.subject_id);
    }
    for (const a of activities as any[]) {
      if (typeof a?.subject_id === 'string') set.add(a.subject_id);
    }
    for (const p of predictions as any[]) {
      if (typeof p?.subject_id === 'string') set.add(p.subject_id);
    }
    for (const i of predictionInterventions as any[]) {
      if (typeof i?.subject_id === 'string') set.add(i.subject_id);
    }
    return Array.from(set).join(',');
  }, [enrolledSubjects, attendance, activities, predictions, predictionInterventions]);

  const { data: subjectsLookup = [] } = useQuery({
    queryKey: ['parent-subject-lookup', studentId, allSubjectIdsKey],
    enabled: !!studentId && allSubjectIdsKey.length > 0,
    queryFn: async () => {
      const ids = allSubjectIdsKey.split(',').filter(Boolean);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from('subjects')
        .select('id, code, name')
        .in('id', ids);
      if (error) throw error;
      return data ?? [];
    },
  });

  const subjectById = useMemo(() => {
    const map = new Map<string, { code: string; name: string }>();
    for (const s of enrolledSubjects) {
      map.set(s.id, { code: s.code, name: s.name });
      map.set(s.subject_id, { code: s.code, name: s.name });
    }
    return map;
  }, [enrolledSubjects]);

  const subjectByIdFromLookup = useMemo(() => {
    const map = new Map<string, { code: string; name: string }>();
    for (const s of subjectsLookup as any[]) {
      if (typeof s?.id !== 'string') continue;
      map.set(s.id, {
        code: (s?.code as string) || (s.id as string),
        name: (s?.name as string) || 'Linked subject',
      });
    }
    return map;
  }, [subjectsLookup]);

  const interventionSubjectByPredictionId = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of predictionInterventions as any[]) {
      if (typeof row?.prediction_id !== 'string' || typeof row?.subject_id !== 'string') continue;
      if (!map.has(row.prediction_id)) map.set(row.prediction_id, row.subject_id);
    }
    return map;
  }, [predictionInterventions]);

  const defaultEnrolledSubject = useMemo(() => {
    if (enrolledSubjects.length === 0) return null;
    if (enrolledSubjects.length === 1) {
      return {
        id: enrolledSubjects[0].id,
        code: enrolledSubjects[0].code,
        name: enrolledSubjects[0].name,
      };
    }
    return {
      id: enrolledSubjects[0].id,
      code: enrolledSubjects[0].code,
      name: enrolledSubjects[0].name,
    };
  }, [enrolledSubjects]);

  const resolveSubjectMeta = useCallback((subjectId?: string | null) => {
    if (subjectId && subjectByIdFromLookup.has(subjectId)) return subjectByIdFromLookup.get(subjectId)!;
    if (subjectId && subjectById.has(subjectId)) return subjectById.get(subjectId)!;
    if (defaultEnrolledSubject) return { code: defaultEnrolledSubject.code, name: defaultEnrolledSubject.name };
    return { code: subjectId || '—', name: 'Unresolved subject' };
  }, [defaultEnrolledSubject, subjectByIdFromLookup, subjectById]);

  const submissionByActivityId = useMemo(() => {
    const map = new Map<string, any>();
    for (const sub of submissions as any[]) {
      if (typeof sub?.activity_id === 'string') map.set(sub.activity_id, sub);
    }
    return map;
  }, [submissions]);

  const attendanceRate = useMemo(() => {
    if (attendance.length === 0) return 0;
    const present = attendance.filter((a: any) => a.status === 'present' || a.status === 'late').length;
    return (present / attendance.length) * 100;
  }, [attendance]);

  const averageScore = useMemo(() => {
    const scored = (activities as any[])
      .map((s: any) => {
        const submission = submissionByActivityId.get(s.id);
        if (submission?.score == null) return null;
        const max = Number(s?.max_score ?? 100);
        if (!Number.isFinite(max) || max <= 0) return null;
        return (Number(submission.score) / max) * 100;
      })
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (scored.length === 0) return 0;
    return scored.reduce((acc, cur) => acc + cur, 0) / scored.length;
  }, [activities, submissionByActivityId]);

  const latestPrediction = predictions[0] ?? null;

  const predictionsResolved = useMemo(() => {
    return (predictions as any[]).map((p: any) => {
      const joinedSubject = relationToObject<any>(p?.subject);
      const fromPredictionSubjectId = typeof p?.subject_id === 'string' ? resolveSubjectMeta(p.subject_id) : null;
      const linkedInterventionSubjectId = interventionSubjectByPredictionId.get(p.id);
      const fromIntervention = linkedInterventionSubjectId
        ? resolveSubjectMeta(linkedInterventionSubjectId)
        : null;
      const fromDefault = defaultEnrolledSubject
        ? { code: defaultEnrolledSubject.code, name: defaultEnrolledSubject.name }
        : null;
      const resolved = {
        code: (joinedSubject?.code as string) || fromPredictionSubjectId?.code || fromIntervention?.code || fromDefault?.code || (p?.subject_id as string) || '—',
        name: (joinedSubject?.name as string) || fromPredictionSubjectId?.name || fromIntervention?.name || fromDefault?.name || 'Unresolved subject',
      };
      return { ...p, resolvedSubject: resolved };
    });
  }, [predictions, interventionSubjectByPredictionId, resolveSubjectMeta, defaultEnrolledSubject]);

  const attendanceBySubject = useMemo(() => {
    const bySubjectId = new Map<string, any[]>();
    for (const row of attendance as any[]) {
      if (typeof row?.subject_id !== 'string') continue;
      const existing = bySubjectId.get(row.subject_id) ?? [];
      existing.push(row);
      bySubjectId.set(row.subject_id, existing);
    }
    return Array.from(bySubjectId.entries()).map(([subjectId, records]) => {
      const meta = resolveSubjectMeta(subjectId);
      const total = records.length;
      const present = records.filter((a: any) => a?.status === 'present' || a?.status === 'late').length;
      const rate = total > 0 ? Math.round((present / total) * 100) : null;
      return {
        id: subjectId,
        subject_id: subjectId,
        code: meta.code,
        name: meta.name,
        records,
        total,
        present,
        rate,
      };
    });
  }, [attendance, resolveSubjectMeta]);

  const gradesBySubject = useMemo(() => {
    const grouped = new Map<string, any[]>();
    for (const a of activities as any[]) {
      if (typeof a?.subject_id !== 'string') continue;
      const existing = grouped.get(a.subject_id) ?? [];
      existing.push(a);
      grouped.set(a.subject_id, existing);
    }
    return Array.from(grouped.entries()).map(([subjectId, subjectActivities]) => {
      const meta = resolveSubjectMeta(subjectId);
      const attendanceRecords = (attendance as any[]).filter((row: any) => row?.subject_id === subjectId);
      const attendancePercent = attendanceRecords.length
        ? (attendanceRecords.filter((a: any) => a.status === 'present' || a.status === 'late').length / attendanceRecords.length) * 100
        : null;
      const gradingSystem = (gradingSystems as any[]).find((g: any) => g.subject_id === subjectId) ?? null;
      const items = subjectActivities.map((a: any) => {
        const submission = submissionByActivityId.get(a.id);
        const score = submission?.score ?? null;
        const max = Number(a?.max_score ?? 100);
        const pct = score != null && Number.isFinite(max) && max > 0 ? Math.round((Number(score) / max) * 100) : null;
        return {
          id: a.id as string,
          title: (a?.title as string) || 'Untitled activity',
          type: (a?.type as string) || 'activity',
          due_date: (a?.due_date as string | null) ?? null,
          max_score: max,
          score,
          pct,
          assessmentType: (submission?.assessment_type as string | null) ?? null,
        };
      });
      const graded = items.filter((i) => i.pct != null);
      const average = graded.length > 0 ? Math.round(graded.reduce((acc, cur) => acc + (cur.pct ?? 0), 0) / graded.length) : null;
      const activityAverage = averageOf(
        items
          .filter((i) => isCourseworkAssessmentType(i.assessmentType || i.type))
          .map((i) => i.pct),
      );
      const projectAverage = averageOf(
        items.filter((i) => isProjectAssessmentType(i.assessmentType || i.type)).map((i) => i.pct),
      );
      const examAverage = averageOf(
        items.filter((i) => isExamAssessmentType(i.assessmentType || i.type)).map((i) => i.pct),
      );
      const weightedAverage = computeWeightedGrade({
        activityAverage,
        projectAverage,
        attendancePercent,
        examAverage,
        weights: gradingSystem,
      });
      return {
        id: subjectId,
        subject_id: subjectId,
        code: meta.code,
        name: meta.name,
        items,
        average,
        weightedAverage,
        gradingSystem,
      };
    });
  }, [activities, submissionByActivityId, resolveSubjectMeta, attendance, gradingSystems]);

  if (role !== 'parent') {
    return (
      <EmptyState
        title="Parent access only"
        body="This page is available to parent/guardian accounts."
      />
    );
  }

  if (linkLoading) {
    return <p className="text-sm text-muted-foreground">Loading linked student…</p>;
  }

  if (!latestLink) {
    return (
      <div className="space-y-6 animate-fade-in">
        <section className="page-section overflow-hidden">
          <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
            <div>
              <h1 className="text-2xl font-display font-bold">Student Performance</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Request access to view your student&apos;s academic information.
              </p>
            </div>
          </div>
        </section>
        <Card className="bg-card/90">
          <CardHeader>
            <CardTitle className="text-lg">Request Student Access</CardTitle>
          </CardHeader>
          <CardContent>
            <RequestStudentAccessForm
              onSubmit={(studentIdNo) => requestAccess.mutate(studentIdNo)}
              isPending={requestAccess.isPending}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!approvedLink && latestLink.status === 'pending_admin') {
    return (
      <div className="space-y-6 animate-fade-in">
        <section className="page-section overflow-hidden">
          <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
            <div>
              <h1 className="text-2xl font-display font-bold">Student Performance</h1>
              <p className="text-sm text-muted-foreground mt-1">
                The student approved your request.
              </p>
            </div>
          </div>
        </section>
        <Card className="bg-card/90">
          <CardHeader>
            <CardTitle className="text-lg">Pending Administrator Approval</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Badge variant="outline">{parentLinkStatusLabel(latestLink.status)}</Badge>
            <p className="text-sm text-muted-foreground">
              An administrator must approve your request before any academic information is available.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!approvedLink && latestLink.status === 'pending') {
    return (
      <div className="space-y-6 animate-fade-in">
        <section className="page-section overflow-hidden">
          <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
            <div>
              <h1 className="text-2xl font-display font-bold">Student Performance</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Your account is pending student approval.
              </p>
            </div>
          </div>
        </section>
        <Card className="bg-card/90">
          <CardHeader>
            <CardTitle className="text-lg">Pending Student Approval</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Badge variant="secondary">Pending Approval</Badge>
            <p className="text-sm text-muted-foreground">
              Your access request has been sent to the student. No academic information is available until the student approves your request.
            </p>
            <p className="text-sm text-muted-foreground">
              The student will receive a notification to review your request.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!approvedLink && (latestLink.status === 'rejected' || latestLink.status === 'admin_rejected')) {
    return (
      <div className="space-y-6 animate-fade-in">
        <section className="page-section overflow-hidden">
          <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
            <div>
              <h1 className="text-2xl font-display font-bold">Student Performance</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Your previous access request was rejected.
              </p>
            </div>
          </div>
        </section>
        <Card className="bg-card/90">
          <CardHeader>
            <CardTitle className="text-lg">Access Request Rejected</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Badge variant="destructive">{parentLinkStatusLabel(latestLink.status)}</Badge>
            <p className="text-sm text-muted-foreground">
              Student ID/No.: {latestLink.student_id_no}
            </p>
            <p className="text-sm text-muted-foreground">
              You can submit a new request. It will need the student&apos;s approval and then an administrator&apos;s approval again.
            </p>
            <RequestStudentAccessForm
              initialStudentId={latestLink.student_id_no}
              submitLabel="Request Again"
              onSubmit={(studentIdNo) => requestAccess.mutate(studentIdNo)}
              isPending={requestAccess.isPending}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!approvedLink || !studentId) {
    return (
      <div className="space-y-6 animate-fade-in">
        <section className="page-section overflow-hidden">
          <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
            <div>
              <h1 className="text-2xl font-display font-bold">Student Performance</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Your student has not approved your parent/guardian request yet.
              </p>
            </div>
          </div>
        </section>
        <EmptyState
          title="Awaiting student approval"
          body="Ask the student to open Settings and approve your parent/guardian request."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in min-w-0">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Linked student"
          value={studentProfile?.full_name || 'Student'}
          hint={`ID: ${studentProfile?.student_id ?? approvedLink.student_id_no}`}
          accent
        />
        <KpiCard label="Attendance" value={`${attendanceRate.toFixed(1)}%`} hint={`${attendance.length} records`} icon={Calendar} />
        <KpiCard label="Average" value={`${averageScore.toFixed(1)}%`} hint={`${submissions.length} submissions`} icon={FileText} />
        <Card>
          <CardContent className="p-5">
            <p className="text-[13px] font-medium text-muted-foreground">Risk</p>
            <div className="mt-3">
              {latestPrediction ? (
                <RiskBadge level={latestPrediction.risk_level} score={latestPrediction.risk_score} />
              ) : (
                <p className="text-sm text-muted-foreground">No predictions yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <PageHeader
          title="Student Performance"
          description="Read-only view for your approved student"
        />
        <div className="lg:col-span-2">
      {!engagementSummary ? (
        <Card className="bg-card/90 border-border/70">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">No engagement summary yet for this student.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-card/90 border-border/70">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Platform engagement
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 text-sm">
              <div className="rounded-lg border p-2 space-y-0.5">
                <p className="text-[10px] text-muted-foreground">Level</p>
                <EngagementBadge level={canonicalEngagementLevel(engagementSummary.engagement_level)} />
              </div>
              <div className="rounded-lg border p-2 space-y-0.5">
                <p className="text-[10px] text-muted-foreground">Score</p>
                <p className="text-lg font-semibold tabular-nums">
                  {Math.round(Number(engagementSummary.engagement_score ?? 0) * 10) / 10}
                </p>
              </div>
              <div className="rounded-lg border p-2 space-y-0.5">
                <p className="text-[10px] text-muted-foreground">Logins</p>
                <p className="text-lg font-semibold tabular-nums">{engagementSummary.total_login_count ?? 0}</p>
              </div>
              <div className="rounded-lg border p-2 space-y-0.5">
                <p className="text-[10px] text-muted-foreground">Time</p>
                <p className="text-xs font-medium leading-snug">{formatTimeSpent(engagementSummary.total_time_spent_seconds)}</p>
              </div>
              <div className="rounded-lg border p-2 space-y-0.5">
                <p className="text-[10px] text-muted-foreground">Last login</p>
                <p className="text-xs font-medium">{formatLastLogin(engagementSummary.last_login_at)}</p>
              </div>
              <div className="rounded-lg border p-2 space-y-0.5">
                <p className="text-[10px] text-muted-foreground">Submitted</p>
                <p className="text-lg font-semibold tabular-nums">{engagementSummary.assignments_submitted ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
        </div>
      </div>

      <Tabs defaultValue="predictions" className="w-full min-w-0">
        <TabsList className="grid w-full grid-cols-3 h-auto sm:h-10">
          <TabsTrigger value="predictions" className="text-xs sm:text-sm">Predictions</TabsTrigger>
          <TabsTrigger value="attendance" className="text-xs sm:text-sm">Attendance</TabsTrigger>
          <TabsTrigger value="grades" className="text-xs sm:text-sm">Grades</TabsTrigger>
        </TabsList>

        <TabsContent value="predictions" className="mt-3">
          <Card className="bg-card/90">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="h-4 w-4" />
                Recent predictions
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <AcademicDisclaimer variant="reminder" className="mb-3" />
              {predictionsResolved.length === 0 ? (
                <p className="text-sm text-muted-foreground">No predictions available yet.</p>
              ) : (
                <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                  {predictionsResolved.map((p: any) => (
                    <div key={p.id} className="rounded-lg border p-3 space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">
                          {p.resolvedSubject.code} — {p.resolvedSubject.name}
                        </p>
                        <RiskBadge level={p.risk_level} score={p.risk_score} />
                      </div>
                      {p.recommendation ? <p className="text-sm text-muted-foreground line-clamp-2">{p.recommendation}</p> : null}
                      <p className="text-xs text-muted-foreground">
                        {p.created_at ? new Date(p.created_at).toLocaleString() : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attendance" className="mt-3">
          <Card className="bg-card/90">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Calendar className="h-4 w-4" />
                Attendance by subject
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {attendanceBySubject.length === 0 ? (
                <p className="text-sm text-muted-foreground">No attendance records available yet.</p>
              ) : (
                <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                  {attendanceBySubject.map((s) => (
                    <section key={s.id} className="space-y-2 rounded-lg border border-border/60 p-3">
                      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                        <p className="font-medium text-sm">{s.code} — {s.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {s.present}/{s.total}{s.rate != null ? ` · ${s.rate}%` : ''}
                        </p>
                      </div>
                      {s.rate != null && <Progress value={s.rate} className="h-1.5" />}
                      {s.records.length > 0 && (
                        <ul className="space-y-1 max-h-32 overflow-y-auto">
                          {s.records.map((r: any) => (
                            <li key={`${s.id}-${r.date}-${r.status}`} className="flex items-center justify-between text-xs border-b border-border/40 pb-1 last:border-0">
                              <span>{formatSessionDate(r.date)}</span>
                              <Badge variant={attendanceBadgeVariant[r.status] ?? 'outline'} className="capitalize text-[10px]">
                                {r.status}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="grades" className="mt-3 space-y-3">
          <Collapsible>
            <Card className="bg-card/90 border-border/70">
              <CollapsibleTrigger asChild>
                <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors rounded-lg">
                  <span className="text-sm font-medium">How to read grades and averages</span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0 text-sm text-muted-foreground space-y-2 border-t border-border/50">
                  <p>
                    Each activity percentage is computed as <span className="font-medium text-foreground">(score / max score) x 100</span>.
                  </p>
                  <p>
                    Subject averages are the mean of graded activity percentages. Weighted scores follow instructor-configured category weights.
                  </p>
                  <p>
                    Risk statuses combine attendance trends, score performance, and predictions.
                  </p>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          <Card className="bg-card/90">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Grades and activities
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {gradesBySubject.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activities available yet.</p>
              ) : (
                <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                  {gradesBySubject.map((s) => (
                    <section key={s.id} className="space-y-2 rounded-lg border border-border/60 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-sm">{s.code} — {s.name}</p>
                        <div className="flex flex-wrap items-center gap-1">
                          {s.average != null ? (
                            <Badge variant="outline" className="text-xs">Avg: {s.average}%</Badge>
                          ) : null}
                          {s.gradingSystem && s.weightedAverage != null ? (
                            <Badge variant="secondary" className="text-xs">Weighted: {Math.round(s.weightedAverage)}%</Badge>
                          ) : null}
                        </div>
                      </div>
                      {s.items.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No activities yet.</p>
                      ) : (
                        <ul className="space-y-1">
                          {s.items.map((a) => (
                            <li key={a.id} className="flex items-center justify-between gap-2 border-b border-border/40 pb-1 last:border-0 text-xs sm:text-sm">
                              <div className="min-w-0">
                                <p className="font-medium truncate">{a.title}</p>
                                <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
                                  {formatAssessmentTypeLabel(a.assessmentType || a.type)}
                                </p>
                              </div>
                              <span className={`shrink-0 ${a.score != null ? 'font-medium' : 'text-muted-foreground'}`}>
                                {a.score != null ? `${a.pct}%` : '—'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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
                Each activity uses percentage scoring: <span className="font-medium text-foreground">(score / max score) x 100</span>.
              </p>
              <p>
                Per subject, the instructor may define a 100% grading system using Activity, Project, Attendance, and Exam weights.
              </p>
              <p>
                Risk statuses are based on attendance trends, score performance, and generated risk predictions.
              </p>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}
