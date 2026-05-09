import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowLeft, UserPlus, Plus, Trash2, CalendarCheck, Users, ClipboardList, Brain, ChevronDown, ChevronUp, Save, Copy, Mail, History } from 'lucide-react';
import { toast } from 'sonner';
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
              <p className="text-sm text-muted-foreground">
                {firstProgram(subject.programs)?.name && (
                  <Badge variant="secondary" className="mr-2">{firstProgram(subject.programs)?.code}</Badge>
                )}
                {subject.semester && `${subject.semester} Semester`}
                {subject.academic_year && ` • ${subject.academic_year}`}
              </p>
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
            <p className="text-sm text-muted-foreground">
              {firstProgram(subject.programs)?.name && (
                <Badge variant="secondary" className="mr-2">{firstProgram(subject.programs)?.code}</Badge>
              )}
              {subject.semester && `${subject.semester} Semester`}
              {subject.academic_year && ` • ${subject.academic_year}`}
            </p>
          </div>
        </div>
        </div>
      </section>

      <Tabs defaultValue="students" className="w-full">
        <TabsList className="grid w-full grid-cols-4 h-12">
          <TabsTrigger value="students" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Students</TabsTrigger>
          <TabsTrigger value="attendance" className="gap-1.5"><CalendarCheck className="h-3.5 w-3.5" /> Attendance</TabsTrigger>
          <TabsTrigger value="activities" className="gap-1.5"><ClipboardList className="h-3.5 w-3.5" /> Activities</TabsTrigger>
          <TabsTrigger value="predictions" className="gap-1.5"><Brain className="h-3.5 w-3.5" /> Predictions</TabsTrigger>
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

  const riskLabel = (level: string) => level === 'critical' ? 'Crucial' : level === 'at_risk' ? 'Vulnerable' : level === 'excelling' ? 'Excelling' : 'Stable';

  return (
    <div className="space-y-6">
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
      {myPrediction && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Risk & recommendation</CardTitle></CardHeader>
          <CardContent>
            <Badge variant={myPrediction.risk_level === 'critical' || myPrediction.risk_level === 'at_risk' ? 'destructive' : myPrediction.risk_level === 'excelling' ? 'default' : 'secondary'}>
              {riskLabel(myPrediction.risk_level)}
            </Badge>
            {myPrediction.recommendation && <p className="mt-2 text-sm text-muted-foreground">{myPrediction.recommendation}</p>}
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
    mutationFn: async () => {
      const { error } = await supabase.from('enrollments').insert({ student_id: selectedStudent, subject_id: subjectId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enrollments', subjectId] });
      toast.success('Student enrolled');
      setEnrollOpen(false);
      setSelectedStudent('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unenroll = useMutation({
    mutationFn: async (enrollmentId: string) => {
      const { error } = await supabase.from('enrollments').delete().eq('id', enrollmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enrollments', subjectId] });
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
                        onClick={() => unenroll.mutate(e.id)}
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
                            unenroll.mutate(e.id)
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
    onSuccess: () => {
      refetchAttendance();
      queryClient.invalidateQueries({ queryKey: ['attendance-history', subjectId] });
      toast.success('Attendance updated');
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activities', subjectId] });
      toast.success('Activity deleted');
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
            <DialogHeader><DialogTitle>New Activity</DialogTitle></DialogHeader>
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
  gradesPublishedAt,
  subjectId,
  maxScore,
  userId,
}: {
  activityId: string;
  activityTitle: string;
  gradesPublishedAt: string | null;
  subjectId: string;
  maxScore: number;
  userId?: string;
}) {
  const queryClient = useQueryClient();
  const [scores, setScores] = useState<Record<string, string>>({});

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

  // Sync scores when submissions load
  const prevSubmissions = submissions;
  if (prevSubmissions.length > 0 && Object.keys(scores).length === 0) {
    const initial: Record<string, string> = {};
    prevSubmissions.forEach(s => {
      if (s.student_id) initial[s.student_id] = s.score?.toString() ?? '';
    });
    if (Object.keys(initial).length > 0) setScores(initial);
  }

  const saveScores = useMutation({
    mutationFn: async () => {
      const ops = enrollments.map(async (e: EnrollmentListRow) => {
        const studentId = e.student_id;
        const scoreVal = scores[studentId];
        if (scoreVal === undefined || scoreVal === '') return;
        const numScore = Number(scoreVal);
        if (isNaN(numScore) || numScore < 0 || numScore > maxScore) return;

        const existing = submissions.find(s => s.student_id === studentId);
        if (existing) {
          const { error } = await supabase.from('submissions').update({ score: numScore, graded_by: userId, graded_at: new Date().toISOString() }).eq('id', existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('submissions').insert({
            activity_id: activityId,
            student_id: studentId,
            score: numScore,
            graded_by: userId,
            graded_at: new Date().toISOString(),
          });
          if (error) throw error;
        }
      });
      await Promise.all(ops);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['submissions', activityId] });
      toast.success('Scores saved');
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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Student</TableHead>
            <TableHead className="w-32">Score (/ {maxScore})</TableHead>
            <TableHead className="w-24">%</TableHead>
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
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => saveScores.mutate()} disabled={saveScores.isPending}>
          <Save className="mr-2 h-4 w-4" />
          {saveScores.isPending ? 'Saving...' : 'Save Scores'}
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

  const { data: counselingReferrals = [] } = useQuery({
    queryKey: ['counseling-referrals', subjectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('counseling_referrals')
        .select('id, student_id, status, created_at')
        .eq('subject_id', subjectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
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
        const latestReferral = counselingReferrals.find(
          (r: any) => r.student_id === interventionPrediction.student_id,
        );

        if (latestReferral?.status !== 'approved') {
          const { error: referralError } = await supabase.from('counseling_referrals').insert({
            student_id: interventionPrediction.student_id,
            subject_id: subjectId,
            instructor_id: user.id,
            prediction_id: interventionPrediction.id,
            recommendation_message:
              interventionMessage ||
              interventionPrediction.recommendation ||
              `Guidance support is recommended for ${subjectCode}.`,
            status: 'pending',
          });
          if (referralError) throw referralError;

          if (sendEmailNotification && studentEmail) {
            const { error: invokeError } = await supabase.functions.invoke('send-notification', {
              body: {
                to: studentEmail,
                student_id: interventionPrediction.student_id,
                subject_id: subjectId,
                risk_level: interventionPrediction.risk_level,
                subject_code: subjectCode,
                subject_name: subjectName,
                body:
                  interventionMessage ||
                  `Your instructor recommends guidance counseling support for ${subjectCode}. Please check EDGE for details.`,
              },
            });
            if (invokeError) throw new Error(invokeError.message || 'Failed to send email');
          }

          return { mode: 'referral_created' as const };
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
        toast.success(
          sendEmailNotification
            ? 'Counseling referral submitted to guidance counselor and student notified'
            : 'Counseling referral submitted to guidance counselor for approval',
        );
      } else {
        toast.success(sendEmailNotification ? 'Intervention logged and email sent' : 'Intervention logged');
      }
      queryClient.invalidateQueries({ queryKey: ['counseling-referrals', subjectId] });
      setInterventionPrediction(null);
      setInterventionMessage('');
      setInterventionType('email');
      setSendEmailNotification(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const riskColor = (level: string) => {
    if (level === 'critical') return 'destructive';
    if (level === 'at_risk') return 'destructive';
    if (level === 'excelling') return 'default';
    return 'secondary';
  };

  const riskLabel = (level: string) => {
    if (level === 'critical') return 'Crucial';
    if (level === 'at_risk') return 'Vulnerable';
    if (level === 'excelling') return 'Excelling';
    return 'Stable';
  };

  const riskOrder = { critical: 0, at_risk: 1, stable: 2, excelling: 3 };
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
          <CardTitle className="text-lg">AI Predictions</CardTitle>
          <div className="flex gap-2">
            {atRiskPredictions.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setBulkNotifyOpen(true)}>
                <Mail className="mr-2 h-4 w-4" />
                Notify vulnerable students
              </Button>
            )}
            <Button size="sm" onClick={generatePredictions} disabled={generating}>
              <Brain className="mr-2 h-4 w-4" />
              {generating ? 'Analyzing...' : 'Generate Predictions'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-muted-foreground text-sm">Loading...</p>
          ) : predictions.length === 0 ? (
            <div className="p-12 text-center">
              <Brain className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground text-sm">No predictions yet. Add students, record attendance & scores, then click "Generate Predictions".</p>
            </div>
          ) : (
            <>
              <div className="px-6 py-2 flex gap-4 text-sm border-b bg-muted/30 flex-wrap">
                <span><strong>{summary.critical}</strong> crucial</span>
                <span><strong>{summary.at_risk}</strong> vulnerable</span>
                <span><strong>{summary.stable}</strong> stable</span>
                <span><strong>{summary.excelling}</strong> excelling</span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Risk Level</TableHead>
                    <TableHead>Attendance</TableHead>
                    <TableHead>Quiz Avg</TableHead>
                    <TableHead>Assignment Avg</TableHead>
                    <TableHead className="min-w-[200px]">Recommendation</TableHead>
                    <TableHead className="w-28">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((p: PredictionRow) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.profile?.full_name || '—'}</TableCell>
                      <TableCell><Badge variant={riskColor(p.risk_level)}>{riskLabel(p.risk_level)}</Badge></TableCell>
                      <TableCell>{p.attendance_rate != null ? `${(p.attendance_rate * 100).toFixed(0)}%` : '—'}</TableCell>
                      <TableCell>{p.quiz_average != null ? `${p.quiz_average.toFixed(1)}%` : '—'}</TableCell>
                      <TableCell>{p.assignment_average != null ? `${p.assignment_average.toFixed(1)}%` : '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.recommendation || '—'}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => setInterventionPrediction(p)}>Log intervention</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={bulkNotifyOpen} onOpenChange={setBulkNotifyOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Notify vulnerable students</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Send an email notification to {atRiskPredictions.filter((p: PredictionRow) => p.profile?.email).length} vulnerable/crucial students for {subjectCode}.</p>
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
          <DialogHeader><DialogTitle>Log intervention</DialogTitle></DialogHeader>
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
                  Counseling interventions require guidance counselor approval first. Saving now will create a counseling referral when not yet approved.
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
