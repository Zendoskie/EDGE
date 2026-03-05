import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
import { ArrowLeft, UserPlus, Plus, Trash2, CalendarCheck, Users, ClipboardList, Brain, ChevronDown, ChevronUp, Save } from 'lucide-react';
import { toast } from 'sonner';

export default function SubjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
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
      return data;
    },
    enabled: !!id,
  });

  if (subjectLoading) return <p className="p-6 text-muted-foreground">Loading...</p>;
  if (!subject) return <p className="p-6 text-destructive">Subject not found.</p>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard/subjects')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-display font-bold">{subject.code} — {subject.name}</h1>
          <p className="text-sm text-muted-foreground">
            {(subject.programs as any)?.name && <Badge variant="secondary" className="mr-2">{(subject.programs as any).code}</Badge>}
            {subject.semester && `${subject.semester} Semester`}
            {subject.academic_year && ` • ${subject.academic_year}`}
          </p>
        </div>
      </div>

      <Tabs defaultValue="students" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="students" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Students</TabsTrigger>
          <TabsTrigger value="attendance" className="gap-1.5"><CalendarCheck className="h-3.5 w-3.5" /> Attendance</TabsTrigger>
          <TabsTrigger value="activities" className="gap-1.5"><ClipboardList className="h-3.5 w-3.5" /> Activities</TabsTrigger>
          <TabsTrigger value="predictions" className="gap-1.5"><Brain className="h-3.5 w-3.5" /> Predictions</TabsTrigger>
        </TabsList>

        <TabsContent value="students">
          <SubjectStudents subjectId={id!} />
        </TabsContent>
        <TabsContent value="attendance">
          <SubjectAttendance subjectId={id!} />
        </TabsContent>
        <TabsContent value="activities">
          <SubjectActivities subjectId={id!} userId={user?.id} />
        </TabsContent>
        <TabsContent value="predictions">
          <SubjectPredictions subjectId={id!} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ───── Students Tab ───── */
function SubjectStudents({ subjectId }: { subjectId: string }) {
  const queryClient = useQueryClient();
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState('');

  const { data: enrollments = [], isLoading } = useQuery({
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
      }));
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

  const enrolledIds = enrollments.map((e: any) => e.student_id);
  const availableStudents = allStudents.filter(s => !enrolledIds.includes(s.user_id));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Enrolled Students</CardTitle>
        <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><UserPlus className="mr-2 h-4 w-4" /> Enroll</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Enroll Student</DialogTitle></DialogHeader>
            <form className="space-y-4" onSubmit={e => { e.preventDefault(); enroll.mutate(); }}>
              <div className="space-y-2">
                <Label>Student</Label>
                <Select value={selectedStudent} onValueChange={setSelectedStudent}>
                  <SelectTrigger><SelectValue placeholder="Select student" /></SelectTrigger>
                  <SelectContent>
                    {availableStudents.map(s => (
                      <SelectItem key={s.user_id} value={s.user_id}>{s.full_name} ({s.email})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={enroll.isPending || !selectedStudent}>
                {enroll.isPending ? 'Enrolling...' : 'Enroll'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <p className="p-6 text-muted-foreground text-sm">Loading...</p>
        ) : enrollments.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground text-sm">No students enrolled yet.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Student ID</TableHead>
                <TableHead className="w-16">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {enrollments.map((e: any) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.profile?.full_name || '—'}</TableCell>
                  <TableCell>{e.profile?.email || '—'}</TableCell>
                  <TableCell>{e.profile?.student_id || '—'}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => unenroll.mutate(e.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ───── Attendance Tab ───── */
function SubjectAttendance({ subjectId }: { subjectId: string }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);

  const { data: enrollments = [] } = useQuery({
    queryKey: ['enrollments', subjectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('enrollments').select('*').eq('subject_id', subjectId);
      if (error) throw error;
      if (!data.length) return [];
      const studentIds = data.map(e => e.student_id).filter(Boolean) as string[];
      const { data: profiles } = await supabase.from('profiles').select('*').in('user_id', studentIds);
      return data.map(e => ({ ...e, profile: profiles?.find(p => p.user_id === e.student_id) }));
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
      toast.success('Attendance updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const getStatus = (studentId: string) => attendanceRecords.find(a => a.student_id === studentId)?.status || '';

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Attendance</CardTitle>
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-auto" />
      </CardHeader>
      <CardContent className="p-0">
        {enrollments.length === 0 ? (
          <p className="p-6 text-muted-foreground text-sm">Enroll students first to record attendance.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {enrollments.map((e: any) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.profile?.full_name || '—'}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {['present', 'absent', 'late', 'excused'].map(status => (
                        <Button
                          key={status}
                          size="sm"
                          variant={getStatus(e.student_id) === status ? 'default' : 'outline'}
                          className="capitalize text-xs"
                          onClick={() => markAttendance.mutate({ studentId: e.student_id, status })}
                        >
                          {status}
                        </Button>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ───── Activities Tab ───── */
function SubjectActivities({ subjectId, userId }: { subjectId: string; userId?: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', type: 'quiz', max_score: '100', weight: '1' });

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
        weight: Number(form.weight),
        subject_id: subjectId,
        created_by: userId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activities', subjectId] });
      toast.success('Activity created');
      setOpen(false);
      setForm({ title: '', type: 'quiz', max_score: '100', weight: '1' });
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Activities</CardTitle>
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
              <div className="grid grid-cols-3 gap-3">
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
                <div className="space-y-2">
                  <Label>Weight</Label>
                  <Input type="number" step="0.1" value={form.weight} onChange={e => setForm(f => ({ ...f, weight: e.target.value }))} />
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
        {isLoading ? (
          <p className="p-6 text-muted-foreground text-sm">Loading...</p>
        ) : activities.length === 0 ? (
          <div className="p-12 text-center">
            <ClipboardList className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground text-sm">No activities yet.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Max Score</TableHead>
                <TableHead>Weight</TableHead>
                <TableHead className="w-16">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activities.map(a => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.title}</TableCell>
                  <TableCell><Badge variant="secondary" className="capitalize">{a.type}</Badge></TableCell>
                  <TableCell>{a.max_score}</TableCell>
                  <TableCell>{a.weight}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => remove.mutate(a.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ───── Predictions Tab ───── */
function SubjectPredictions({ subjectId }: { subjectId: string }) {
  const { data: predictions = [], isLoading } = useQuery({
    queryKey: ['predictions', subjectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('predictions')
        .select('*')
        .eq('subject_id', subjectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      // enrich with profiles
      if (!data.length) return [];
      const studentIds = data.map(p => p.student_id).filter(Boolean) as string[];
      const { data: profiles } = await supabase.from('profiles').select('*').in('user_id', studentIds);
      return data.map(p => ({ ...p, profile: profiles?.find(pr => pr.user_id === p.student_id) }));
    },
  });

  const riskColor = (level: string) => {
    if (level === 'high') return 'destructive';
    if (level === 'medium') return 'secondary';
    return 'default';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">AI Predictions</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <p className="p-6 text-muted-foreground text-sm">Loading...</p>
        ) : predictions.length === 0 ? (
          <div className="p-12 text-center">
            <Brain className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground text-sm">No predictions generated yet. Add students, attendance, and activity scores first.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Risk Level</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Recommendation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {predictions.map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.profile?.full_name || '—'}</TableCell>
                  <TableCell><Badge variant={riskColor(p.risk_level)} className="capitalize">{p.risk_level}</Badge></TableCell>
                  <TableCell>{p.confidence ? `${(p.confidence * 100).toFixed(0)}%` : '—'}</TableCell>
                  <TableCell className="max-w-xs truncate">{p.recommendation || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
