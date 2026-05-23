import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { canonicalRiskLevel, riskLabel, riskVariant } from '@/lib/risk-utils';
import { BookOpen, Calendar, FileText, Brain } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { averageOf, computeWeightedGrade } from '@/lib/weighted-grading';
import { filterSubmissionsByActiveSubjects } from '@/lib/student-performance-scope';
import { AcademicDisclaimer } from '@/components/AcademicDisclaimer';

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

export default function ParentPerformance() {
  const { user, role } = useAuth();

  const { data: approvedLink, isLoading: linkLoading } = useQuery({
    queryKey: ['parent-approved-link', user?.id],
    enabled: role === 'parent' && !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('parent_student_links')
        .select('student_user_id, student_id_no')
        .eq('parent_user_id', user!.id)
        .eq('status', 'approved')
        .order('requested_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const studentId = approvedLink?.student_user_id ?? null;

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
        .select('id, subject_id, risk_level, recommendation, created_at, subject:subjects!predictions_subject_id_fkey(code,name)')
        .eq('student_id', studentId!)
        .in('subject_id', enrolledSubjectIds)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
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
        .select('activity_id, score, submitted_at, graded_at, activities(subject_id)')
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
        };
      });
      const graded = items.filter((i) => i.pct != null);
      const average = graded.length > 0 ? Math.round(graded.reduce((acc, cur) => acc + (cur.pct ?? 0), 0) / graded.length) : null;
      const activityAverage = averageOf(items.filter((i) => i.type === 'quiz' || i.type === 'assignment' || i.type === 'activity').map((i) => i.pct));
      const projectAverage = averageOf(items.filter((i) => i.type === 'project').map((i) => i.pct));
      const examAverage = averageOf(items.filter((i) => i.type === 'exam').map((i) => i.pct));
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
    <div className="space-y-6 animate-fade-in">
      <section className="page-section overflow-hidden">
        <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
          <div>
            <h1 className="text-2xl font-display font-bold">Student Performance</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Read-only academic performance for your approved student.
            </p>
          </div>
        </div>
      </section>

      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle className="text-lg">Linked student</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-medium">{studentProfile?.full_name || 'Student'}</p>
          <p className="text-sm text-muted-foreground">
            Student ID/No.: {studentProfile?.student_id ?? approvedLink.student_id_no}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-card/90">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Attendance</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{attendanceRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">Based on {attendance.length} records</p>
          </CardContent>
        </Card>
        <Card className="bg-card/90">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average score</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{averageScore.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">Based on {submissions.length} submissions</p>
          </CardContent>
        </Card>
        <Card className="bg-card/90">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Latest risk status</CardTitle>
            <Brain className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {latestPrediction ? (
              <Badge variant={riskVariant(canonicalRiskLevel(latestPrediction.risk_level))}>
                {riskLabel(canonicalRiskLevel(latestPrediction.risk_level))}
              </Badge>
            ) : (
              <p className="text-sm text-muted-foreground">No predictions yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/90 border-border/70">
        <CardHeader>
          <CardTitle className="text-lg">How scores and risk are calculated</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Each activity uses percentage scoring: <span className="font-medium text-foreground">(score / max score) x 100</span>.
          </p>
          <p>
            Per subject, the instructor may define a 100% grading system using Activity, Project, Attendance, and Exam (midterm + finals) weights.
            The weighted score follows those configured percentages.
          </p>
          <p>
            Risk statuses are based on attendance trends, score performance, and generated risk predictions.
            Lower weighted results across multiple components increase the chance of Vulnerable or Crucial classification.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BookOpen className="h-5 w-5" />
            Recent predictions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AcademicDisclaimer variant="reminder" className="mb-3" />
          {predictionsResolved.length === 0 ? (
            <p className="text-sm text-muted-foreground">No predictions available yet.</p>
          ) : (
            <div className="space-y-3">
              {predictionsResolved.map((p: any) => (
                <div key={p.id} className="rounded-lg border p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">
                      {p.resolvedSubject.code} — {p.resolvedSubject.name}
                    </p>
                    <Badge variant={riskVariant(canonicalRiskLevel(p.risk_level))}>
                      {riskLabel(canonicalRiskLevel(p.risk_level))}
                    </Badge>
                  </div>
                  {p.recommendation ? <p className="text-sm text-muted-foreground">{p.recommendation}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    {p.created_at ? new Date(p.created_at).toLocaleString() : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Calendar className="h-5 w-5" />
            Attendance by subject
          </CardTitle>
        </CardHeader>
        <CardContent>
          {attendanceBySubject.length === 0 ? (
            <p className="text-sm text-muted-foreground">No attendance records available yet.</p>
          ) : (
            <div className="space-y-6">
              {attendanceBySubject.map((s) => (
                <section key={s.id} className="space-y-3 rounded-xl border border-border/60 p-4">
                  <div className="flex flex-col gap-1">
                    <p className="font-semibold">{s.code} — {s.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {s.present} present / late out of {s.total} records
                      {s.rate != null ? ` · ${s.rate}%` : ''}
                    </p>
                  </div>
                  {s.rate != null && <Progress value={s.rate} className="h-2" />}
                  {s.records.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No attendance yet for this subject.</p>
                  ) : (
                    <ul className="space-y-2">
                      {s.records.map((r: any) => (
                        <li key={`${s.id}-${r.date}-${r.status}`} className="flex items-center justify-between border-b border-border/40 pb-2 last:border-0">
                          <span className="text-sm">{formatSessionDate(r.date)}</span>
                          <Badge variant={attendanceBadgeVariant[r.status] ?? 'outline'} className="capitalize">
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

      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5" />
            Grades and activities
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-5 rounded-lg border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">How to read exact grades and averages</p>
            <p>
              Each activity percentage is computed as <span className="font-medium text-foreground">(score / max score) x 100</span>. Example:
              if score is <span className="font-medium text-foreground">42</span> out of <span className="font-medium text-foreground">50</span>, that activity contributes
              <span className="font-medium text-foreground"> 84%</span>.
            </p>
            <p>
              The subject average shown on each row is the arithmetic mean of all graded activity percentages in that subject:
              <span className="font-medium text-foreground"> (sum of activity percentages) / (number of graded activities)</span>.
              Ungraded activities are listed but are not included in the average yet.
            </p>
            <p>
              If an instructor grading system exists, the weighted result follows:
              <span className="font-medium text-foreground"> (Activity x w1 + Project x w2 + Attendance x w3 + Exam x w4) / (w1 + w2 + w3 + w4)</span>.
              Exam category includes both midterm and finals records entered as exam activities.
            </p>
            <p>
              Struggle areas are identified when repeated low percentages appear in the list, especially when paired with low attendance and
              risk outputs (Vulnerable/Crucial). This means the same underlying records in this table are the basis of the overall performance indicators.
            </p>
          </div>
          {gradesBySubject.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activities available yet.</p>
          ) : (
            <div className="space-y-6">
              {gradesBySubject.map((s) => (
                <section key={s.id} className="space-y-3 rounded-xl border border-border/60 p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">{s.code} — {s.name}</p>
                    <div className="flex items-center gap-2">
                      {s.average != null ? (
                        <Badge variant="outline">
                          Activity Avg: {s.average}%
                        </Badge>
                      ) : null}
                      {s.gradingSystem && s.weightedAverage != null ? (
                        <Badge variant="secondary">
                          Weighted: {Math.round(s.weightedAverage)}%
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  {s.items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No activities yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {s.items.map((a) => (
                        <li key={a.id} className="flex items-center justify-between border-b border-border/40 pb-2 last:border-0 text-sm">
                          <div>
                            <p className="font-medium">{a.title}</p>
                            <p className="text-xs text-muted-foreground capitalize">
                              {a.type}
                              {a.due_date ? ` · Due ${new Date(a.due_date).toLocaleDateString()}` : ''}
                            </p>
                          </div>
                          <span className={a.score != null ? 'font-medium' : 'text-muted-foreground'}>
                            {a.score != null
                              ? `${a.score} / ${a.max_score} (${a.pct}%)`
                              : 'Not graded'}
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
    </div>
  );
}
