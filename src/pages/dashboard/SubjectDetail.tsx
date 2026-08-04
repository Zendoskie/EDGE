import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowLeft, UserPlus, Plus, Trash2, CalendarCheck, Users, ClipboardList, Brain, ChevronDown, ChevronUp, Save, Copy, Mail, History, Lightbulb, Activity } from 'lucide-react';
import { toast } from 'sonner';
import { invalidateStudentLinkedCaches } from '@/lib/student-performance-scope';
import { ASSESSMENT_TYPES, formatAssessmentTypeLabel, type AssessmentType } from '@/lib/assessment-types';
import { recalculateSubjectRisk } from '@/lib/recalculate-risk';
import { RiskBadge } from '@/components/RiskBadge';
import { EngagementBadge } from '@/components/EngagementBadge';
import { StudentEngagementPanel } from '@/components/StudentEngagementPanel';
import { AcademicDisclaimer } from '@/components/AcademicDisclaimer';
import { useTrackPageView } from '@/hooks/useActivityTracker';
import { sendReferralNotification } from '@/lib/referral-notifications';
import { normalizeReferralStatus } from '@/lib/referral-utils';
import type {
  EmbeddedProgram,
  EnrollmentListRow,
  PredictionRow,
  SendNotificationResponse,
  SubjectWithInstructor,
} from '@/types/dashboard';

function firstProgram(programs: SubjectWithInstructor['programs']): EmbeddedProgram | null {
  if (!programs) return null;
  return Array.isArray(programs) ? programs[0] ?? null : programs;
}

export default function SubjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const queryClient = useQueryClient();

  const { data: subject, isLoading: subjectLoading } = useQuery({
    queryKey: ['subject', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subjects')
        .select('*, programs(name, code)')
        .eq('id', id!)
        .single();
      if (error) throw error;
      if (!data?.instructor_id) return data;
      const { data: instructorProfile } = await supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .eq('user_id', data.instructor_id)
        .maybeSingle();
      return { ...data, instructor_profile: instructorProfile ?? null } as SubjectWithInstructor;
    },
    enabled: !!id,
  });

  const copyCode = () => {
    if (!subject?.code) return;
    navigator.clipboard.writeText(subject.code);
    toast.success('Course code copied to clipboard');
  };

  if (subjectLoading) return <p className="p-6 text-muted-foreground">Loading...</p>;
  if (!subject) return <p className="p-6 text-destructive">Subject not found.</p>;

  const isInstructor = role === 'instructor';
  const backUrl = isInstructor ? '/dashboard/subjects' : '/dashboard/my-subjects';

  if (!isInstructor) {
    return (
      <div className="space-y-6 animate-fade-in">
        <section className="page-section overflow-hidden">
          <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(backUrl)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-display font-bold">{subject.code} — {subject.name}</h1>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={copyCode} title="Copy course code">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
                {firstProgram(subject.programs)?.name && (
                  <Badge variant="secondary">{firstProgram(subject.programs)?.code}</Badge>
                )}
                <span>
                  {subject.semester && `${subject.semester} Semester`}
                  {subject.academic_year && ` • ${subject.academic_year}`}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Instructor: {(subject.instructor_profile?.full_name ?? '').trim() || subject.instructor_profile?.email || '—'}
              </p>
            </div>
          </div>
          </div>
        </section>
        <StudentSubjectView subjectId={id!} subjectCode={subject.code} userId={user?.id} />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <section className="page-section overflow-hidden">
        <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(backUrl)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-display font-bold">{subject.code} — {subject.name}</h1>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={copyCode} title="Copy course code">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
              {firstProgram(subject.programs)?.name && (
                <Badge variant="secondary">{firstProgram(subject.programs)?.code}</Badge>
              )}
              <span>
                {subject.semester && `${subject.semester} Semester`}
                {subject.academic_year && ` • ${subject.academic_year}`}
              </span>
            </div>
          </div>
        </div>
        </div>
      </section>

      <Tabs defaultValue="students" className="w-full">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 gap-1 h-auto sm:h-12 py-1">
          <TabsTrigger value="students" className="gap-1 text-xs sm:text-sm sm:gap-1.5"><Users className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Students</span></TabsTrigger>
          <TabsTrigger value="attendance" className="gap-1 text-xs sm:text-sm sm:gap-1.5"><CalendarCheck className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Attendance</span></TabsTrigger>
          <TabsTrigger value="activities" className="gap-1 text-xs sm:text-sm sm:gap-1.5"><ClipboardList className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Activities</span></TabsTrigger>
          <TabsTrigger value="predictions" className="gap-1 text-xs sm:text-sm sm:gap-1.5"><Brain className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Predictions</span></TabsTrigger>
        </TabsList>

        <TabsContent value="students">
          <SubjectStudents
            subjectId={id!}
            programCode={firstProgram(subject.programs)?.code ?? undefined}
            programName={firstProgram(subject.programs)?.name ?? undefined}
          />
        </TabsContent>
        <TabsContent value="attendance">
          <SubjectAttendance
            subjectId={id!}
            programCode={firstProgram(subject.programs)?.code ?? undefined}
            programName={firstProgram(subject.programs)?.name ?? undefined}
          />
        </TabsContent>
        <TabsContent value="activities">
          <SubjectActivities subjectId={id!} userId={user?.id} />
        </TabsContent>
        <TabsContent value="predictions">
          <SubjectPredictions subjectId={id!} subjectCode={subject.code} subjectName={subject.name} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ───── Student read-only view ───── */
function StudentSubjectView({ subjectId, subjectCode, userId }: { subjectId: string; subjectCode: string; userId?: string }) {
  useTrackPageView('view_subject_page', subjectId, `${subjectCode} subject page`);

  const { data: myPrediction } = useQuery({
    queryKey: ['my-prediction', subjectId, userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from('predictions')
        .select('*')
        .eq('subject_id', subjectId)
        .eq('student_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!userId,
  });

  return (
    <div className="space-y-6">
      <Card className="bg-card/90 border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Risk Analysis</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {myPrediction ? (
            <div className="flex flex-wrap items-center gap-3">
              <RiskBadge level={myPrediction.risk_level} score={myPrediction.risk_score} />
              {myPrediction.risk_score != null && (
                <span className="text-muted-foreground">
                  Score: <span className="font-medium text-foreground">{Number(myPrediction.risk_score).toFixed(1)}</span>/100
                </span>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">No risk classification yet for this subject.</p>
          )}
        </CardContent>
      </Card>
      <Card className="bg-card/90 border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Attendance &amp; scores</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            Detailed attendance and grades for <span className="font-medium text-foreground">{subjectCode}</span> are on the{' '}
            <Link to="/dashboard/my-attendance" className="text-primary font-medium underline-offset-4 hover:underline">
              My Attendance
            </Link>{' '}
            and{' '}
            <Link to="/dashboard/my-scores" className="text-primary font-medium underline-offset-4 hover:underline">
              Scores
            </Link>{' '}
            pages.
          </p>
        </CardContent>
      </Card>
      {myPrediction?.recommendation && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Recommendation</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{myPrediction.recommendation}</p>
            <AcademicDisclaimer variant="reminder" className="mt-3" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ───── Students Tab ───── */
function SubjectStudents({
  subjectId,
  programCode,
  programName,
}: {
  subjectId: string;
  programCode?: string;
  programName?: string;
}) {
  const queryClient = useQueryClient();
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState('');

  const { data: enrollments = [], isLoading } = useQuery<EnrollmentListRow[]>({
    queryKey: ['enrollments', subjectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enrollments')
        .select('*')
        .eq('subject_id', subjectId);
      if (error) throw error;
      // fetch profiles for enrolled students
      if (!data.length) return [];
      const studentIds = data.map(e => e.student_id).filter(Boolean) as string[];
      const { data: profiles } = await supabase.from('profiles').select('*').in('user_id', studentIds);
      return data.map(e => ({
        ...e,
        profile: profiles?.find(p => p.user_id === e.student_id),
      })) as EnrollmentListRow[];
    },
  });

  const { data: allStudents = [] } = useQuery({
    queryKey: ['all-students'],
    queryFn: async () => {
      const { data: roles } = await supabase.from('user_roles').select('user_id').eq('role', 'student');
      if (!roles?.length) return [];
      const { data: profiles } = await supabase.from('profiles').select('*').in('user_id', roles.map(r => r.user_id));
      return profiles || [];
    },
  });

  const enroll = useMutation({
    mutationFn: async (studentId: string) => {
      const { error } = await supabase.from('enrollments').insert({ student_id: studentId, subject_id: subjectId });
      if (error) throw error;
      return studentId;
    },
    onSuccess: (studentId) => {
      queryClient.invalidateQueries({ queryKey: ['enrollments', subjectId] });
      invalidateStudentLinkedCaches(queryClient, studentId);
      toast.success('Student enrolled');
      setEnrollOpen(false);
      setSelectedStudent('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unenroll = useMutation({
    mutationFn: async (vars: { enrollmentId: string; studentId: string }) => {
      const { error } = await supabase.from('enrollments').delete().eq('id', vars.enrollmentId);
      if (error) throw error;
      return vars.studentId;
    },
    onSuccess: (studentId) => {
      queryClient.invalidateQueries({ queryKey: ['enrollments', subjectId] });
      invalidateStudentLinkedCaches(queryClient, studentId);
      toast.success('Student removed');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activeEnrollments = enrollments.filter((e: EnrollmentListRow) => e.status === 'active');
  const pendingEnrollments = enrollments.filter((e: EnrollmentListRow) => e.status === 'pending');
  const enrolledIds = activeEnrollments.map((e: EnrollmentListRow) => e.student_id);
  const availableStudents = allStudents.filter(s => !enrolledIds.includes(s.user_id));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Enrolled Students</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <p className="p-6 text-muted-foreground text-sm">Loading...</p>
        ) : activeEnrollments.length === 0 ? (
          <div className="p-6 text-muted-foreground text-sm">No students enrolled yet.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Student ID</TableHead>
                <TableHead>Program</TableHead>
                <TableHead className="w-16">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeEnrollments.map((e: EnrollmentListRow) => {
                const profile = e.profile;
                const programLabel = programCode
                  ? `${programCode}${programName ? ` — ${programName}` : ''}`
                  : '—';
                return (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">{profile?.full_name || '—'}</TableCell>
                    <TableCell>{profile?.email || '—'}</TableCell>
                    <TableCell>{profile?.student_id || '—'}</TableCell>
                    <TableCell>{programLabel}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => unenroll.mutate({ enrollmentId: e.id, studentId: e.student_id })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {/* Pending enrollment requests */}
        {pendingEnrollments.length > 0 && (
          <div className="border-t border-border mt-4 pt-4">
            <h3 className="px-6 pb-2 text-sm font-medium text-muted-foreground">Pending enrollment requests</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Student ID</TableHead>
                  <TableHead>Program</TableHead>
                  <TableHead className="w-40">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingEnrollments.map((e: EnrollmentListRow) => {
                  const profile = e.profile;
                  const programLabel = programCode
                    ? `${programCode}${programName ? ` — ${programName}` : ''}`
                    : '—';
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{profile?.full_name || '—'}</TableCell>
                      <TableCell>{profile?.email || '—'}</TableCell>
                      <TableCell>{profile?.student_id || '—'}</TableCell>
                      <TableCell>{programLabel}</TableCell>
                      <TableCell className="space-x-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            supabase
                              .from('enrollments')
                              .update({ status: 'active' })
                              .eq('id', e.id)
                              .then(({ error }) => {
                                if (error) {
                                  toast.error(error.message);
                                } else {
                                  queryClient.invalidateQueries({ queryKey: ['enrollments', subjectId] });
                                  invalidateStudentLinkedCaches(queryClient, e.student_id);
                                  toast.success('Enrollment approved');
                                }
                              })
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            unenroll.mutate({ enrollmentId: e.id, studentId: e.student_id })
                          }
                        >
                          Reject
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ───── Attendance Tab ───── */
function SubjectAttendance({
  subjectId,
  programCode,
  programName,
}: {
  subjectId: string;
  programCode?: string;
  programName?: string;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);

  const { data: enrollments = [] } = useQuery<EnrollmentListRow[]>({
    queryKey: ['enrollments', subjectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enrollments')
        .select('*')
        .eq('subject_id', subjectId)
        .eq('status', 'active');
      if (error) throw error;
      if (!data.length) return [];
      const studentIds = data.map(e => e.student_id).filter(Boolean) as string[];
      const { data: profiles } = await supabase.from('profiles').select('*').in('user_id', studentIds);
      return data.map(e => ({ ...e, profile: profiles?.find(p => p.user_id === e.student_id) })) as EnrollmentListRow[];
    },
  });

  const { data: attendanceRecords = [], refetch: refetchAttendance } = useQuery({
    queryKey: ['attendance', subjectId, date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attendance')
        .select('*')
        .eq('subject_id', subjectId)
        .eq('date', date);
      if (error) throw error;
      return data;
    },
  });

  const { data: attendanceHistory = [], isLoading: historyLoading } = useQuery({
    queryKey: ['attendance-history', subjectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attendance')
        .select('id, date, student_id, status, created_at')
        .eq('subject_id', subjectId)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const markAttendance = useMutation({
    mutationFn: async ({ studentId, status }: { studentId: string; status: string }) => {
      const existing = attendanceRecords.find(a => a.student_id === studentId);
      if (existing) {
        const { error } = await supabase.from('attendance').update({ status }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('attendance').insert({
          student_id: studentId,
          subject_id: subjectId,
          date,
          status,
          recorded_by: user?.id,
        });
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      refetchAttendance();
      queryClient.invalidateQueries({ queryKey: ['attendance-history', subjectId] });
      toast.success('Attendance updated');
      const result = await recalculateSubjectRisk(subjectId);
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: ['predictions', subjectId] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const getStatus = (studentId: string) => attendanceRecords.find(a => a.student_id === studentId)?.status || '';
  const profileByStudentId = new Map(
    enrollments
      .map((e: EnrollmentListRow) => [e.student_id, e.profile] as const)
      .filter(([studentId]) => !!studentId),
  );

  const statusBadgeVariant = (status: string) => {
    if (status === 'absent') return 'destructive';
    if (status === 'present') return 'default';
    return 'secondary';
  };

  return (
    <Card>
      <CardHeader className="space-y-2 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-lg">Attendance</CardTitle>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-auto" />
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <Tabs defaultValue="record" className="w-full">
          <TabsList className="h-10">
            <TabsTrigger value="record">Record Attendance</TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5">
              <History className="h-3.5 w-3.5" />
              History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="record" className="mt-4">
            {enrollments.length === 0 ? (
              <p className="p-4 text-muted-foreground text-sm">Enroll students first to record attendance.</p>
            ) : (
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead>Program</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {enrollments.map((e: EnrollmentListRow) => {
                      const profile = e.profile;
                      const programLabel = programCode
                        ? `${programCode}${programName ? ` — ${programName}` : ''}`
                        : '—';
                      return (
                        <TableRow key={e.id}>
                          <TableCell className="font-medium">{profile?.full_name || '—'}</TableCell>
                          <TableCell>{programLabel}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1.5">
                              {['present', 'absent', 'late', 'excused'].map(status => (
                                <Button
                                  key={status}
                                  size="sm"
                                  variant={getStatus(e.student_id) === status ? 'default' : 'outline'}
                                  className="capitalize text-xs h-8"
                                  onClick={() => markAttendance.mutate({ studentId: e.student_id, status })}
                                >
                                  {status}
                                </Button>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            {historyLoading ? (
              <p className="p-4 text-muted-foreground text-sm">Loading history...</p>
            ) : attendanceHistory.length === 0 ? (
              <p className="p-4 text-muted-foreground text-sm">No attendance history yet.</p>
            ) : (
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead>Program</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attendanceHistory.map((record: any) => {
                      const profile = profileByStudentId.get(record.student_id);
                      const programLabel = programCode
                        ? `${programCode}${programName ? ` — ${programName}` : ''}`
                        : '—';
                      return (
                        <TableRow key={record.id}>
                          <TableCell>{record.date ? new Date(record.date).toLocaleDateString() : '—'}</TableCell>
                          <TableCell className="font-medium">{profile?.full_name || '—'}</TableCell>
                          <TableCell>{programLabel}</TableCell>
                          <TableCell>
                            <Badge variant={statusBadgeVariant(record.status)} className="capitalize">
                              {record.status || '—'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

/* ───── Activities Tab ───── */
function SubjectActivities({ subjectId, userId }: { subjectId: string; userId?: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', type: 'quiz', max_score: '100' });
  const [expandedActivity, setExpandedActivity] = useState<string | null>(null);
  const [weights, setWeights] = useState({
    activity_weight: '25',
    project_weight: '25',
    attendance_weight: '15',
    exam_weight: '35',
  });

  const { data: gradingSystem } = useQuery({
    queryKey: ['subject-grading-system', subjectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subject_grading_systems')
        .select('subject_id, activity_weight, project_weight, attendance_weight, exam_weight')
        .eq('subject_id', subjectId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!subjectId,
  });

  useEffect(() => {
    if (!gradingSystem) return;
    setWeights({
      activity_weight: String(gradingSystem.activity_weight ?? 25),
      project_weight: String(gradingSystem.project_weight ?? 25),
      attendance_weight: String(gradingSystem.attendance_weight ?? 15),
      exam_weight: String(gradingSystem.exam_weight ?? 35),
    });
  }, [gradingSystem]);

  const { data: activities = [], isLoading } = useQuery({
    queryKey: ['activities', subjectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('activities').select('*').eq('subject_id', subjectId).order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('activities').insert({
        title: form.title,
        type: form.type,
        max_score: Number(form.max_score),
        subject_id: subjectId,
        created_by: userId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activities', subjectId] });
      toast.success('Activity created');
      setOpen(false);
      setForm({ title: '', type: 'quiz', max_score: '100' });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (actId: string) => {
      const { error } = await supabase.from('activities').delete().eq('id', actId);
      if (error) throw error;
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['activities', subjectId] });
      toast.success('Activity deleted');
      const result = await recalculateSubjectRisk(subjectId);
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: ['predictions', subjectId] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveGradingSystem = useMutation({
    mutationFn: async () => {
      const payload = {
        subject_id: subjectId,
        activity_weight: Number(weights.activity_weight),
        project_weight: Number(weights.project_weight),
        attendance_weight: Number(weights.attendance_weight),
        exam_weight: Number(weights.exam_weight),
        updated_at: new Date().toISOString(),
      };

      const allValues = [
        payload.activity_weight,
        payload.project_weight,
        payload.attendance_weight,
        payload.exam_weight,
      ];
      if (allValues.some((v) => !Number.isFinite(v) || v < 0 || v > 100)) {
        throw new Error('Each grading weight must be between 0 and 100.');
      }
      const total = allValues.reduce((sum, v) => sum + v, 0);
      if (total !== 100) {
        throw new Error(`Total weight must be exactly 100%. Current total: ${total}%.`);
      }

      const { error } = await supabase
        .from('subject_grading_systems')
        .upsert(payload, { onConflict: 'subject_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Grading system saved');
      queryClient.invalidateQueries({ queryKey: ['subject-grading-system', subjectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalWeight =
    (Number(weights.activity_weight) || 0) +
    (Number(weights.project_weight) || 0) +
    (Number(weights.attendance_weight) || 0) +
    (Number(weights.exam_weight) || 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Activities & Scores</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="mr-2 h-4 w-4" /> Add Activity</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Activity</DialogTitle>
              <DialogDescription>Create a quiz, assignment, project, or exam for this subject.</DialogDescription>
            </DialogHeader>
            <form className="space-y-4" onSubmit={e => { e.preventDefault(); create.mutate(); }}>
              <div className="space-y-2">
                <Label>Title</Label>
                <Input placeholder="e.g. Quiz 1" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="quiz">Quiz</SelectItem>
                      <SelectItem value="assignment">Assignment</SelectItem>
                      <SelectItem value="project">Project</SelectItem>
                      <SelectItem value="exam">Exam</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Max Score</Label>
                  <Input type="number" value={form.max_score} onChange={e => setForm(f => ({ ...f, max_score: e.target.value }))} />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={create.isPending}>
                {create.isPending ? 'Creating...' : 'Create Activity'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        <div className="mx-4 mt-4 mb-3 rounded-lg border border-border/70 bg-muted/20 p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm font-medium text-foreground">Subject grading system (must total 100%)</p>
            <Badge variant={totalWeight === 100 ? 'default' : 'destructive'}>
              Total: {totalWeight}%
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Only the instructor assigned to this course can create or edit the grading system.
            This system is used for percentage-based evaluation in student and parent views.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label>Activity %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={weights.activity_weight}
                onChange={(e) => setWeights((prev) => ({ ...prev, activity_weight: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Project %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={weights.project_weight}
                onChange={(e) => setWeights((prev) => ({ ...prev, project_weight: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Attendance %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={weights.attendance_weight}
                onChange={(e) => setWeights((prev) => ({ ...prev, attendance_weight: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Exam (Midterm + Finals) %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={weights.exam_weight}
                onChange={(e) => setWeights((prev) => ({ ...prev, exam_weight: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => saveGradingSystem.mutate()} disabled={saveGradingSystem.isPending}>
              {saveGradingSystem.isPending ? 'Saving...' : 'Save Grading System'}
            </Button>
          </div>
        </div>
        <div className="mx-4 mb-3 rounded-lg border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground space-y-2">
          <p className="font-medium text-foreground">How grading percentages and struggle signals work</p>
          <p>
            Per-student activity percentage is calculated as
            <span className="font-medium text-foreground"> (entered score / activity max score) x 100</span>.
            Example: score <span className="font-medium text-foreground">35</span> out of <span className="font-medium text-foreground">50</span> gives <span className="font-medium text-foreground">70%</span>.
          </p>
          <p>
            Subject-level trends are built from these percentages across activities. When several low percentages appear over time
            (especially with poor attendance), students are more likely to be classified as
            <span className="font-medium text-foreground"> Vulnerable</span> or <span className="font-medium text-foreground">Crucial</span> in Predictions.
          </p>
          <p>
            This means the exact numbers encoded here in the score grid are the direct basis for averages, risk analysis,
            and intervention recommendations.
          </p>
        </div>
        {isLoading ? (
          <p className="p-6 text-muted-foreground text-sm">Loading...</p>
        ) : activities.length === 0 ? (
          <div className="p-12 text-center">
            <ClipboardList className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground text-sm">No activities yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {activities.map(a => (
              <div key={a.id}>
                <div
                  className="flex items-center px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setExpandedActivity(expandedActivity === a.id ? null : a.id)}
                >
                  <div className="flex-1 flex items-center gap-3">
                    <span className="font-medium">{a.title}</span>
                    <Badge variant="secondary" className="capitalize">{a.type}</Badge>
                    <span className="text-xs text-muted-foreground">Max score: {a.max_score}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={e => { e.stopPropagation(); remove.mutate(a.id); }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    {expandedActivity === a.id ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </div>
                {expandedActivity === a.id && (
                  <ActivityScoring
                    activityId={a.id}
                    activityTitle={a.title}
                    activityType={a.type}
                    gradesPublishedAt={a.grades_published_at ?? null}
                    subjectId={subjectId}
                    maxScore={a.max_score}
                    userId={userId}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ───── Activity Scoring Sub-component ───── */
function ActivityScoring({
  activityId,
  activityTitle,
  activityType,
  gradesPublishedAt,
  subjectId,
  maxScore,
  userId,
}: {
  activityId: string;
  activityTitle: string;
  activityType: string;
  gradesPublishedAt: string | null;
  subjectId: string;
  maxScore: number;
  userId?: string;
}) {
  const queryClient = useQueryClient();
  const [scores, setScores] = useState<Record<string, string>>({});
  const [assessmentType, setAssessmentType] = useState<AssessmentType | ''>('');

  const { data: enrollments = [] } = useQuery<EnrollmentListRow[]>({
    queryKey: ['enrollments', subjectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('enrollments').select('*').eq('subject_id', subjectId);
      if (error) throw error;
      if (!data.length) return [];
      const studentIds = data.map(e => e.student_id).filter(Boolean) as string[];
      const { data: profiles } = await supabase.from('profiles').select('*').in('user_id', studentIds);
      return data.map(e => ({ ...e, profile: profiles?.find(p => p.user_id === e.student_id) })) as EnrollmentListRow[];
    },
  });

  const { data: submissions = [], isLoading } = useQuery({
    queryKey: ['submissions', activityId],
    queryFn: async () => {
      const { data, error } = await supabase.from('submissions').select('*').eq('activity_id', activityId);
      if (error) throw error;
      return data;
    },
  });

  // Initialize scores from existing submissions
  useState(() => {
    if (submissions.length > 0) {
      const initial: Record<string, string> = {};
      submissions.forEach(s => {
        if (s.student_id) initial[s.student_id] = s.score?.toString() ?? '';
      });
      setScores(initial);
    }
  });

  // Sync scores and assessment type when submissions load
  const prevSubmissions = submissions;
  if (prevSubmissions.length > 0 && Object.keys(scores).length === 0) {
    const initial: Record<string, string> = {};
    prevSubmissions.forEach(s => {
      if (s.student_id) initial[s.student_id] = s.score?.toString() ?? '';
    });
    if (Object.keys(initial).length > 0) setScores(initial);
  }
  if (prevSubmissions.length > 0 && !assessmentType) {
    const existingType = prevSubmissions.find(s => s.assessment_type)?.assessment_type;
    if (existingType) setAssessmentType(existingType as AssessmentType);
  }

  const saveScores = useMutation({
    mutationFn: async () => {
      const hasScoresToSave = enrollments.some((e: EnrollmentListRow) => {
        const scoreVal = scores[e.student_id];
        if (scoreVal === undefined || scoreVal === '') return false;
        const numScore = Number(scoreVal);
        return !isNaN(numScore) && numScore >= 0 && numScore <= maxScore;
      });

      if (hasScoresToSave && !assessmentType) {
        throw new Error('Assessment Type is required before saving grades.');
      }

      const ops = enrollments.map(async (e: EnrollmentListRow) => {
        const studentId = e.student_id;
        const scoreVal = scores[studentId];
        if (scoreVal === undefined || scoreVal === '') return;
        const numScore = Number(scoreVal);
        if (isNaN(numScore) || numScore < 0 || numScore > maxScore) return;

        const existing = submissions.find(s => s.student_id === studentId);
        const gradePayload = {
          score: numScore,
          assessment_type: assessmentType,
          graded_by: userId,
          graded_at: new Date().toISOString(),
        };
        if (existing) {
          const { error } = await supabase.from('submissions').update(gradePayload).eq('id', existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('submissions').insert({
            activity_id: activityId,
            student_id: studentId,
            ...gradePayload,
          });
          if (error) throw error;
          // Assignment submission engagement is recorded by DB trigger on submissions.
        }
      });
      await Promise.all(ops);
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['submissions', activityId] });
      toast.success('Scores saved');
      const result = await recalculateSubjectRisk(subjectId);
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: ['predictions', subjectId] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publishGrades = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('Missing instructor session');
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from('activities')
        .update({ grades_published_at: nowIso, grades_published_by: userId })
        .eq('id', activityId);
      if (error) throw error;

      try {
        const { error: invokeError } = await supabase.functions.invoke('notify-missing-grades', {
          body: { activity_id: activityId },
        });
        if (!invokeError) return;

        let msg = invokeError.message || 'Failed to notify missing grades';
        const ctx = (invokeError as { context?: Response }).context;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const j = (await ctx.clone().json()) as { error?: string };
            if (j?.error) msg = j.error;
          } catch {
            /* use msg */
          }
        }

        // Common root cause: the function hasn't been deployed to the Supabase project yet.
        if (msg.toLowerCase().includes('failed to send a request')) {
          msg = `${msg}. This usually means the Edge Function is not deployed or not reachable from the configured Supabase project.`;
        }
        throw new Error(msg);
      } catch (e) {
        // Roll back publish if notification step fails.
        await supabase
          .from('activities')
          .update({ grades_published_at: null, grades_published_by: null })
          .eq('id', activityId);
        throw e;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activities', subjectId] });
      toast.success('Grades published. Missing-grade students will be notified.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unpublishGrades = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('Missing instructor session');
      const { error } = await supabase
        .from('activities')
        .update({ grades_published_at: null, grades_published_by: null })
        .eq('id', activityId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activities', subjectId] });
      toast.success('Grades unpublished');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <p className="px-4 py-3 text-sm text-muted-foreground">Loading scores...</p>;

  if (enrollments.length === 0) {
    return <p className="px-4 py-3 text-sm text-muted-foreground">Enroll students first to input scores.</p>;
  }

  return (
    <div className="border-t border-border bg-muted/30 px-4 py-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground">Grades status</p>
          {gradesPublishedAt ? (
            <Badge variant="default">Published</Badge>
          ) : (
            <Badge variant="secondary">Not published</Badge>
          )}
          {gradesPublishedAt ? (
            <span className="text-xs text-muted-foreground">
              {new Date(gradesPublishedAt).toLocaleString()}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {gradesPublishedAt ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => unpublishGrades.mutate()}
              disabled={unpublishGrades.isPending}
            >
              {unpublishGrades.isPending ? 'Unpublishing...' : 'Unpublish'}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => publishGrades.mutate()}
              disabled={publishGrades.isPending}
              title={`Publish grades for ${activityTitle}`}
            >
              {publishGrades.isPending ? 'Publishing...' : 'Publish grades'}
            </Button>
          )}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 sm:items-end max-w-md">
        <div className="space-y-2">
          <Label htmlFor={`assessment-type-${activityId}`}>Assessment Type</Label>
          <Select
            value={assessmentType || undefined}
            onValueChange={(v) => setAssessmentType(v as AssessmentType)}
          >
            <SelectTrigger id={`assessment-type-${activityId}`}>
              <SelectValue placeholder="Select assessment type" />
            </SelectTrigger>
            <SelectContent>
              {ASSESSMENT_TYPES.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!assessmentType && (
            <p className="text-xs text-muted-foreground">Required when saving grades.</p>
          )}
        </div>
        {assessmentType ? (
          <div className="text-sm text-muted-foreground pb-2">
            Selected: <span className="font-medium text-foreground">{formatAssessmentTypeLabel(assessmentType)}</span>
          </div>
        ) : null}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Student</TableHead>
            <TableHead className="w-32">Score (/ {maxScore})</TableHead>
            <TableHead className="w-24">%</TableHead>
            <TableHead className="w-36">Assessment Type</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {enrollments.map((e: EnrollmentListRow) => {
            const profile = e.profile;
            const scoreStr =
              scores[e.student_id] ??
              submissions.find(s => s.student_id === e.student_id)?.score?.toString() ??
              '';
            const numScore = Number(scoreStr);
            const pct =
              scoreStr && !isNaN(numScore) ? ((numScore / maxScore) * 100).toFixed(1) : '—';
            return (
              <TableRow key={e.student_id}>
                <TableCell className="font-medium">{profile?.full_name || '—'}</TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={0}
                    max={maxScore}
                    placeholder="—"
                    value={
                      scores[e.student_id] ??
                      submissions.find(s => s.student_id === e.student_id)?.score?.toString() ??
                      ''
                    }
                    onChange={ev =>
                      setScores(prev => ({ ...prev, [e.student_id]: ev.target.value }))
                    }
                    className="h-8 w-24"
                  />
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {pct === '—' ? '—' : `${pct}%`}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatAssessmentTypeLabel(
                    assessmentType ||
                      submissions.find(s => s.student_id === e.student_id)?.assessment_type,
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => saveScores.mutate()}
          disabled={saveScores.isPending || !assessmentType}
          title={!assessmentType ? 'Select an Assessment Type before saving' : undefined}
        >
          <Save className="mr-2 h-4 w-4" />
          {saveScores.isPending ? 'Saving...' : 'Save Scores'}
        </Button>
      </div>
    </div>
  );
}

type RiskBreakdownItem = { label: string; percent: number | null; weight: number };

function RiskScoreBreakdown({ items }: { items: RiskBreakdownItem[] }) {
  return (
    <div className="space-y-2 min-w-[200px]">
      {items.map((item) => {
        const contrib =
          item.percent != null && Number.isFinite(item.percent)
            ? (item.percent * item.weight).toFixed(1)
            : null;
        const barWidth = item.percent != null && Number.isFinite(item.percent) ? Math.min(100, item.percent) : 0;
        return (
          <div key={item.label}>
            <div className="flex items-center justify-between gap-2 text-xs mb-0.5">
              <span className="text-muted-foreground">{item.label}</span>
              <span className="tabular-nums text-foreground/90">
                {item.percent != null ? `${item.percent.toFixed(0)}%` : '—'}
                {contrib != null ? (
                  <span className="text-muted-foreground"> · {contrib} pts</span>
                ) : null}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary/60 transition-all"
                style={{ width: `${barWidth}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function recommendationForPrediction(p: PredictionRow): string {
  const attendancePercent = p.attendance_rate != null ? p.attendance_rate * 100 : null;
  const fmt = (value: number | null) =>
    value != null && Number.isFinite(value) ? `${Math.round(value)}%` : 'no data yet';
  const lowest = [
    { label: 'academic activities', value: p.academic_performance },
    { label: 'attendance', value: attendancePercent },
    { label: 'exams', value: p.exam_average },
    { label: 'quizzes', value: p.quiz_average },
    { label: 'assignments', value: p.assignment_average },
  ]
    .filter((item): item is { label: string; value: number } => item.value != null && Number.isFinite(item.value))
    .sort((a, b) => a.value - b.value)[0];
  const scoreText =
    p.risk_score != null && Number.isFinite(p.risk_score) ? `${Number(p.risk_score).toFixed(1)}/100` : 'current level';

  if (p.risk_level === 'excelling') {
    return `Maintain excellent performance. Risk score is ${scoreText}; encourage the student to keep consistent study habits and attendance.`;
  }
  if (p.risk_level === 'stable') {
    return lowest
      ? `Student is stable. Monitor ${lowest.label} (${fmt(lowest.value)}) and provide light support to stay on track.`
      : 'Student is stable. Continue regular monitoring as more grades and attendance records are added.';
  }
  if (p.risk_level === 'at_risk') {
    return lowest
      ? `Student is vulnerable. Prioritize intervention for ${lowest.label} (${fmt(lowest.value)}) and schedule a follow-up after the next assessment.`
      : 'Student is vulnerable. Review available grades and attendance, then schedule a support check-in.';
  }
  return lowest
    ? `Student is crucial. Immediate intervention recommended, starting with ${lowest.label} (${fmt(lowest.value)}).`
    : 'Student is crucial. Immediate intervention recommended; verify grades and attendance records for next steps.';
}

const PREDICTIONS_STICKY_COL =
  'sticky right-0 z-10 w-[300px] min-w-[280px] bg-card border-l border-border/60 shadow-[-6px_0_12px_-8px_rgba(0,0,0,0.25)]';

function PredictionRecommendationCell({
  recommendation,
  studentId,
  studentName,
  riskLevel,
  onViewEngagement,
  onLogIntervention,
  onSubmitCounselingReferral,
  isSubmittingReferral,
}: {
  recommendation: string;
  studentId?: string | null;
  studentName?: string | null;
  riskLevel?: string | null;
  onViewEngagement: (studentId: string, studentName: string) => void;
  onLogIntervention: () => void;
  onSubmitCounselingReferral?: () => void;
  isSubmittingReferral?: boolean;
}) {
  const showReferralCta = riskLevel === 'critical' || riskLevel === 'at_risk';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex max-h-28 gap-2 overflow-y-auto overscroll-y-contain pr-1">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <p className="text-sm leading-relaxed text-foreground">{recommendation}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 border-t border-border/50 bg-card pt-2">
        {studentId ? (
          <Button
            size="sm"
            variant="outline"
            className="h-8 shrink-0"
            onClick={() => onViewEngagement(studentId, studentName || 'Student')}
          >
            <Activity className="mr-1.5 h-3.5 w-3.5" />
            Engagement
          </Button>
        ) : null}
        {showReferralCta && onSubmitCounselingReferral ? (
          <Button
            size="sm"
            variant="secondary"
            className="h-8 shrink-0"
            onClick={onSubmitCounselingReferral}
            disabled={isSubmittingReferral}
          >
            {isSubmittingReferral ? 'Submitting…' : 'Submit Counseling Referral'}
          </Button>
        ) : null}
        <Button size="sm" variant="default" className="h-8 shrink-0" onClick={onLogIntervention}>
          Log intervention
        </Button>
      </div>
    </div>
  );
}

/* ───── Predictions Tab ───── */
function SubjectPredictions({ subjectId, subjectCode, subjectName }: { subjectId: string; subjectCode: string; subjectName: string }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [generating, setGenerating] = useState(false);
  const [interventionPrediction, setInterventionPrediction] = useState<PredictionRow | null>(null);
  // DB constraint for interventions.type only allows a limited set of values:
  // email | meeting | counseling | other
  const [interventionType, setInterventionType] = useState<string>('email');
  const [interventionMessage, setInterventionMessage] = useState('');
  const [sendEmailNotification, setSendEmailNotification] = useState(false);
  const [bulkNotifyOpen, setBulkNotifyOpen] = useState(false);
  const [bulkNotifyMessage, setBulkNotifyMessage] = useState('');
  const [bulkNotifyPreparing, setBulkNotifyPreparing] = useState(false);
  const [engagementStudent, setEngagementStudent] = useState<{
    studentId: string;
    studentName: string;
  } | null>(null);

  const { data: predictions = [], isLoading } = useQuery<PredictionRow[]>({
    queryKey: ['predictions', subjectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('predictions')
        .select('*')
        .eq('subject_id', subjectId)
        .order('risk_level', { ascending: true });
      if (error) throw error;
      if (!data.length) return [];
      const studentIds = data.map(p => p.student_id).filter(Boolean) as string[];
      const { data: profiles } = await supabase.from('profiles').select('*').in('user_id', studentIds);
      return data.map(p => ({ ...p, profile: profiles?.find(pr => pr.user_id === p.student_id) })) as PredictionRow[];
    },
  });

  const studentIdsForEngagement = useMemo(
    () => predictions.map((p) => p.student_id).filter(Boolean) as string[],
    [predictions],
  );

  const { data: engagementByStudent = new Map() } = useQuery({
    queryKey: ['predictions-engagement', subjectId, studentIdsForEngagement.join(',')],
    queryFn: async () => {
      if (studentIdsForEngagement.length === 0) return new Map();
      const { data, error } = await supabase
        .from('student_engagement_summary')
        .select('student_id, engagement_level, engagement_score')
        .in('student_id', studentIdsForEngagement);
      if (error) throw error;
      return new Map((data ?? []).map((r) => [r.student_id, r]));
    },
    enabled: studentIdsForEngagement.length > 0,
  });

  const { data: counselingReferrals = [] } = useQuery({
    queryKey: ['counseling-referrals', subjectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('counseling_referrals')
        .select('id, student_id, subject_id, status, created_at, reviewed_at')
        .eq('subject_id', subjectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const invalidateReferralCaches = (studentId?: string | null) => {
    void queryClient.invalidateQueries({ queryKey: ['counseling-referrals', subjectId] });
    if (studentId) {
      void queryClient.invalidateQueries({ queryKey: ['student-counseling-referrals', studentId] });
    }
    void queryClient.invalidateQueries({ queryKey: ['instructor-counseling-referrals'] });
    void queryClient.invalidateQueries({ queryKey: ['guidance-referrals'] });
  };

  const submitCounselingReferral = useMutation({
    mutationFn: async (prediction: PredictionRow) => {
      if (!user?.id || !prediction.student_id || !prediction.id) {
        throw new Error('Missing prediction or instructor session');
      }

      const pendingReferral = counselingReferrals.find(
        (r) =>
          r.student_id === prediction.student_id &&
          r.subject_id === subjectId &&
          normalizeReferralStatus(r.status) === 'pending',
      );
      if (pendingReferral) {
        throw new Error('A pending counseling referral already exists for this student in this subject.');
      }

      const approvedReferral = counselingReferrals.find(
        (r) =>
          r.student_id === prediction.student_id &&
          r.subject_id === subjectId &&
          normalizeReferralStatus(r.status) === 'approved',
      );
      if (approvedReferral) {
        throw new Error('A counseling referral has already been approved for this student in this subject.');
      }

      const message =
        prediction.recommendation?.trim() ||
        recommendationForPrediction(prediction) ||
        `Guidance support is recommended for ${subjectCode}.`;

      const { data: inserted, error: referralError } = await supabase
        .from('counseling_referrals')
        .insert({
          student_id: prediction.student_id,
          subject_id: subjectId,
          instructor_id: user.id,
          prediction_id: prediction.id,
          recommendation_message: message,
          status: 'pending',
        })
        .select('id')
        .single();

      if (referralError) throw referralError;

      await sendReferralNotification({
        event: 'referral_created',
        referralId: inserted.id,
      });

      return { referralId: inserted.id, studentId: prediction.student_id };
    },
    onSuccess: (result) => {
      toast.success('Counseling referral submitted. Student and guidance counselors have been notified.');
      invalidateReferralCaches(result.studentId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const generatePredictions = async () => {
    setGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('Please log in');
        return;
      }

      const { data, error } = await supabase.functions.invoke('predict-risk', {
        body: { subject_id: subjectId },
      });

      if (error) {
        let msg = error.message;
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const j = (await ctx.clone().json()) as { error?: string };
            if (j?.error) msg = j.error;
          } catch {
            /* use msg */
          }
        }
        toast.error(msg || 'Failed to generate predictions');
        return;
      }

      if (data && typeof data === 'object' && 'error' in data && (data as { error?: string }).error) {
        toast.error(String((data as { error: string }).error));
        return;
      }

      const count = (data as { count?: number })?.count ?? 0;
      toast.success(`Generated predictions for ${count} students`);
      queryClient.invalidateQueries({ queryKey: ['predictions', subjectId] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Prediction failed');
    } finally {
      setGenerating(false);
    }
  };

  const logIntervention = useMutation({
    mutationFn: async () => {
      if (!interventionPrediction?.id || !interventionPrediction?.student_id) throw new Error('Missing prediction');
      const studentEmail = interventionPrediction.profile?.email;
      // DB check constraint only allows: email | meeting | counseling | other.
      const dbInterventionType =
        interventionType === 'email' ||
        interventionType === 'meeting' ||
        interventionType === 'counseling' ||
        interventionType === 'other'
          ? interventionType
          : 'other';

      if (dbInterventionType === 'counseling') {
        if (!user?.id) throw new Error('Missing instructor session');

        const pendingReferral = counselingReferrals.find(
          (r) =>
            r.student_id === interventionPrediction.student_id &&
            r.subject_id === subjectId &&
            normalizeReferralStatus(r.status) === 'pending',
        );
        if (pendingReferral) {
          throw new Error('A pending counseling referral already exists for this student in this subject.');
        }

        const approvedReferral = counselingReferrals.find(
          (r) =>
            r.student_id === interventionPrediction.student_id &&
            normalizeReferralStatus(r.status) === 'approved',
        );

        if (!approvedReferral) {
          const { data: inserted, error: referralError } = await supabase
            .from('counseling_referrals')
            .insert({
              student_id: interventionPrediction.student_id,
              subject_id: subjectId,
              instructor_id: user.id,
              prediction_id: interventionPrediction.id,
              recommendation_message:
                interventionMessage ||
                interventionPrediction.recommendation ||
                `Guidance support is recommended for ${subjectCode}.`,
              status: 'pending',
            })
            .select('id')
            .single();
          if (referralError) throw referralError;

          await sendReferralNotification({
            event: 'referral_created',
            referralId: inserted.id,
          });

          return { mode: 'referral_created' as const, studentId: interventionPrediction.student_id };
        }
      }

      if (sendEmailNotification && studentEmail) {
        const { error: invokeError } = await supabase.functions.invoke('send-notification', {
          body: {
            to: studentEmail,
            student_id: interventionPrediction.student_id,
            subject_id: subjectId,
            risk_level: interventionPrediction.risk_level,
            subject_code: subjectCode,
            subject_name: subjectName,
            body: interventionMessage || `Your instructor has logged an intervention for ${subjectCode}. Please check the EDGE platform for details.`,
          },
        });
        if (invokeError) throw new Error(invokeError.message || 'Failed to send email');
      }

      const { error } = await supabase.from('interventions').insert({
        prediction_id: interventionPrediction.id,
        student_id: interventionPrediction.student_id,
        subject_id: subjectId,
        type: dbInterventionType,
        message: interventionMessage || null,
      });
      if (error) throw error;
      return { mode: 'intervention_logged' as const };
    },
    onSuccess: (result) => {
      if (result?.mode === 'referral_created') {
        toast.success('Counseling referral submitted. Student and guidance counselors have been notified.');
        invalidateReferralCaches(result.studentId);
      } else {
        toast.success(sendEmailNotification ? 'Intervention logged and email sent' : 'Intervention logged');
      }
      setInterventionPrediction(null);
      setInterventionMessage('');
      setInterventionType('email');
      setSendEmailNotification(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const riskOrder = { excelling: 0, stable: 1, at_risk: 2, critical: 3 };
  const sorted = [...predictions].sort(
    (a: PredictionRow, b: PredictionRow) =>
      (riskOrder[a.risk_level as keyof typeof riskOrder] ?? 1) - (riskOrder[b.risk_level as keyof typeof riskOrder] ?? 1),
  );

  const summary = {
    critical: predictions.filter((p: PredictionRow) => p.risk_level === 'critical').length,
    at_risk: predictions.filter((p: PredictionRow) => p.risk_level === 'at_risk').length,
    stable: predictions.filter((p: PredictionRow) => p.risk_level === 'stable').length,
    excelling: predictions.filter((p: PredictionRow) => p.risk_level === 'excelling').length,
  };

  const atRiskPredictions = predictions.filter(
    (p: PredictionRow) => p.risk_level === 'critical' || p.risk_level === 'at_risk',
  );

  const sendBulkNotifications = async () => {
    const withEmail = atRiskPredictions.filter((p: PredictionRow) => p.profile?.email);
    if (withEmail.length === 0) {
      toast.error('No vulnerable students have email on file');
      return;
    }
    setBulkNotifyPreparing(true);
    const msg = bulkNotifyMessage || `Your instructor has an update regarding ${subjectCode}. Please check the EDGE platform and consider reaching out for support.`;
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('send-notification', {
        body: {
          subject_code: subjectCode,
          subject_name: subjectName,
          body: msg,
          recipients: withEmail.map((p: PredictionRow) => ({
            to: p.profile?.email,
            student_id: p.student_id,
            subject_id: subjectId,
            risk_level: p.risk_level,
          })),
        },
      });
      if (invokeError) throw new Error(invokeError.message || 'Failed to send emails');

      const payload = data as SendNotificationResponse | null;
      const sent = payload?.sent ?? 0;
      const failed = payload?.failed ?? 0;
      const errors = payload?.errors;

      setBulkNotifyOpen(false);
      setBulkNotifyMessage('');
      toast.success(`Sent notifications to ${sent} of ${withEmail.length} vulnerable students`);
      if (failed > 0) {
        const first = errors?.[0]?.message;
        toast.error(first ? `Some emails failed: ${first}` : 'Some emails failed. Check Resend settings.');
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Bulk email failed');
    } finally {
      setBulkNotifyPreparing(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-lg">Risk Analysis</CardTitle>
          <div className="flex gap-2">
            {atRiskPredictions.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setBulkNotifyOpen(true)}>
                <Mail className="mr-2 h-4 w-4" />
                Notify vulnerable students
              </Button>
            )}
            <Button size="sm" onClick={generatePredictions} disabled={generating}>
              <Brain className="mr-2 h-4 w-4" />
              {generating ? 'Calculating...' : 'Recalculate Risk Scores'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-muted-foreground text-sm">Loading...</p>
          ) : predictions.length === 0 ? (
            <div className="p-12 text-center">
              <Brain className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground text-sm">No risk scores yet. Add students, record attendance &amp; scores, then click &quot;Recalculate Risk Scores&quot; (or scores update automatically when you save grades or attendance).</p>
            </div>
          ) : (
            <>
              <div className="px-4 sm:px-6 pt-4 pb-1">
                <AcademicDisclaimer variant="reminder" />
              </div>
              <div className="px-6 py-3 flex flex-wrap gap-x-6 gap-y-1 text-sm border-b bg-muted/30">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-blue-600" />
                  <strong>{summary.excelling}</strong> excelling
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-600" />
                  <strong>{summary.stable}</strong> stable
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                  <strong>{summary.at_risk}</strong> vulnerable
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-destructive" />
                  <strong>{summary.critical}</strong> crucial
                </span>
              </div>
              <div className="overflow-x-auto">
              <Table className="w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[150px]">Student</TableHead>
                    <TableHead className="w-[90px]">Risk Score</TableHead>
                    <TableHead className="min-w-[200px]">Breakdown</TableHead>
                    <TableHead className="w-[120px]">Classification</TableHead>
                    <TableHead className="w-[110px]">Engagement</TableHead>
                    <TableHead className="w-[90px]">Attendance</TableHead>
                    <TableHead className="w-[80px]">Quiz Avg</TableHead>
                    <TableHead className="w-[100px]">Assignment Avg</TableHead>
                    <TableHead className={PREDICTIONS_STICKY_COL}>Recommendation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((p: PredictionRow) => {
                    const engagement = p.student_id ? engagementByStudent.get(p.student_id) : undefined;
                    const recommendation = p.recommendation?.trim() || recommendationForPrediction(p);
                    const breakdownItems: RiskBreakdownItem[] = [
                      { label: 'Academic', percent: p.academic_performance, weight: 0.5 },
                      {
                        label: 'Attendance',
                        percent: p.attendance_rate != null ? p.attendance_rate * 100 : null,
                        weight: 0.2,
                      },
                      { label: 'Exam', percent: p.exam_average, weight: 0.3 },
                    ];
                    return (
                    <TableRow key={p.id} className="align-middle">
                      <TableCell className="font-medium">{p.profile?.full_name || '—'}</TableCell>
                      <TableCell>
                        {p.risk_score != null ? (
                          <div className="flex items-baseline gap-0.5">
                            <span className="text-xl font-semibold tabular-nums">{Number(p.risk_score).toFixed(1)}</span>
                            <span className="text-xs text-muted-foreground">/100</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <RiskScoreBreakdown items={breakdownItems} />
                      </TableCell>
                      <TableCell>
                        <RiskBadge level={p.risk_level} />
                      </TableCell>
                      <TableCell>
                        {engagement ? (
                          <EngagementBadge level={engagement.engagement_level} />
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {p.attendance_rate != null ? `${(p.attendance_rate * 100).toFixed(0)}%` : '—'}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {p.quiz_average != null ? `${p.quiz_average.toFixed(1)}%` : '—'}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {p.assignment_average != null ? `${p.assignment_average.toFixed(1)}%` : '—'}
                      </TableCell>
                      <TableCell className={`${PREDICTIONS_STICKY_COL} align-top`}>
                        <PredictionRecommendationCell
                          recommendation={recommendation}
                          studentId={p.student_id}
                          studentName={p.profile?.full_name}
                          riskLevel={p.risk_level}
                          onViewEngagement={(studentId, studentName) =>
                            setEngagementStudent({ studentId, studentName })
                          }
                          onLogIntervention={() => setInterventionPrediction(p)}
                          onSubmitCounselingReferral={() => submitCounselingReferral.mutate(p)}
                          isSubmittingReferral={submitCounselingReferral.isPending}
                        />
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!engagementStudent} onOpenChange={(open) => !open && setEngagementStudent(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Student Engagement</DialogTitle>
            <DialogDescription>
              Login activity, live engagement charts, and feedback for this student.
            </DialogDescription>
          </DialogHeader>
          {engagementStudent ? (
            <StudentEngagementPanel
              studentId={engagementStudent.studentId}
              studentName={engagementStudent.studentName}
              subjectIds={[subjectId]}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={bulkNotifyOpen} onOpenChange={setBulkNotifyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Notify vulnerable students</DialogTitle>
            <DialogDescription>
              Send an email notification to {atRiskPredictions.filter((p: PredictionRow) => p.profile?.email).length} vulnerable/crucial students for {subjectCode}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Message (optional)</Label>
            <Input
              placeholder="Custom message or leave blank for default"
              value={bulkNotifyMessage}
              onChange={e => setBulkNotifyMessage(e.target.value)}
              className="min-h-[80px]"
            />
          </div>
          <Button onClick={sendBulkNotifications} disabled={bulkNotifyPreparing}>
            {bulkNotifyPreparing ? 'Preparing...' : 'Open email draft'}
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={!!interventionPrediction} onOpenChange={(open) => !open && setInterventionPrediction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log intervention</DialogTitle>
            <DialogDescription>Record an intervention for this student and optionally notify them by email.</DialogDescription>
          </DialogHeader>
          {interventionPrediction && (
            <form className="space-y-4" onSubmit={e => { e.preventDefault(); logIntervention.mutate(); }}>
              <p className="text-sm text-muted-foreground">Student: {interventionPrediction.profile?.full_name || '—'}</p>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={interventionType} onValueChange={setInterventionType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">email</SelectItem>
                    <SelectItem value="meeting">meeting</SelectItem>
                    <SelectItem value="counseling">counseling</SelectItem>
                    <SelectItem value="other">other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Message (optional)</Label>
                <Input placeholder="Note or summary" value={interventionMessage} onChange={e => setInterventionMessage(e.target.value)} />
              </div>
              {interventionType === 'counseling' && (
                <p className="text-xs text-muted-foreground">
                  Counseling interventions require guidance counselor approval first. Saving will create a counseling referral and automatically notify the student and guidance counselors.
                </p>
              )}
              <div className="flex items-center space-x-2">
                <Checkbox id="send-email" checked={sendEmailNotification} onCheckedChange={(c) => setSendEmailNotification(!!c)} />
                <Label htmlFor="send-email" className="text-sm font-normal cursor-pointer">
                  Send email notification to student (Gmail/email)
                </Label>
              </div>
              {sendEmailNotification && !interventionPrediction?.profile?.email && (
                <p className="text-xs text-warning-foreground">Student has no email on file. Notification will not be sent.</p>
              )}
              <Button type="submit" disabled={logIntervention.isPending}>{logIntervention.isPending ? 'Saving...' : 'Save'}</Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
