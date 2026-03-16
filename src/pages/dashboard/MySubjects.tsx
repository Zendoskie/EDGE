import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { BookOpen, ChevronRight, KeyRound, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

export default function MySubjects() {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [enrollCode, setEnrollCode] = useState('');

  const programCode = (user?.user_metadata as any)?.course as string | undefined;

  const { data: studentProgram } = useQuery({
    queryKey: ['student-program', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('student_programs')
        .select('id')
        .eq('student_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id && role === 'student',
  });

  const { data: enrollmentsWithSubjects = [], isLoading } = useQuery({
    queryKey: ['my-enrollments', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('enrollments')
        .select('id, enrolled_at, status, subject_id, subjects(id, code, name, semester, academic_year, instructor_id)')
        .eq('student_id', user.id)
        .order('enrolled_at', { ascending: false });
      if (error) throw error;
      const instructorIds = Array.from(
        new Set(
          (data ?? [])
            .map((row: any) => row.subjects?.instructor_id)
            .filter(Boolean),
        ),
      ) as string[];
      if (instructorIds.length === 0) return data;
      const { data: instructorProfiles } = await supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .in('user_id', instructorIds);
      return (data ?? []).map((row: any) => ({
        ...row,
        subjects: row.subjects
          ? {
              ...row.subjects,
              instructor_profile: instructorProfiles?.find(p => p.user_id === row.subjects.instructor_id) ?? null,
            }
          : row.subjects,
      }));
    },
    enabled: !!user?.id,
  });

  const { data: allSubjects = [], isLoading: loadingSubjects } = useQuery({
    queryKey: ['all-subjects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subjects')
        .select('id, code, name, semester, academic_year, instructor_id, program_id, programs(code, name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = data || [];
      const instructorIds = Array.from(new Set(rows.map((s: any) => s.instructor_id).filter(Boolean))) as string[];
      if (instructorIds.length === 0) return rows;
      const { data: instructorProfiles } = await supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .in('user_id', instructorIds);
      return rows.map((s: any) => ({
        ...s,
        instructor_profile: instructorProfiles?.find(p => p.user_id === s.instructor_id) ?? null,
      }));
    },
    enabled: !!user?.id,
  });

  const enrollByCode = useMutation({
    mutationFn: async (code: string) => {
      const trimmed = code.trim().toUpperCase();
      if (!trimmed) throw new Error('Please enter a course code.');
      
      // First, get the subject details to check restrictions
      const { data: subject, error: findError } = await supabase
        .from('subjects')
        .select('id, code, name, program_id, programs(code, name)')
        .ilike('code', trimmed)
        .maybeSingle();
      if (findError) throw findError;
      if (!subject) throw new Error(`No course found with code "${code.trim()}".`);
      
      // Check if student can enroll based on program restriction
      if (subject.program_id) {
        const { data: studentPrograms, error: programError } = await supabase
          .from('student_programs')
          .select('program_id, year_level, is_irregular, programs(code, name)')
          .eq('student_id', user!.id);
        if (programError) throw programError;
        let studentProgram = studentPrograms?.[0] ?? null;

        // If student has no program record yet but their auth metadata course matches
        // this subject's program code, auto-create a student_programs row for them.
        if (!studentProgram) {
          const metaCourseCode = (user!.user_metadata as any)?.course as string | undefined;
          if (metaCourseCode && subject.programs?.code === metaCourseCode) {
            const { data: created, error: createError } = await supabase
              .from('student_programs')
              .insert({
                student_id: user!.id,
                program_id: subject.program_id,
              })
              .select('program_id, year_level, is_irregular, programs(code, name)')
              .single();
            if (!createError) {
              studentProgram = created;
            }
          }
        }

        // If student has a program record, check if any allows enrollment (irregular or matching program)
        const isIrregular = studentProgram?.is_irregular === true;
        const programMatches = studentProgram && subject.program_id && String(studentProgram.program_id) === String(subject.program_id);
        if (isIrregular || programMatches) {
          // Allow enrollment
        } else if (studentProgram) {
          throw new Error(`This course is only available for ${subject.programs?.code || 'specific program'} students.`);
        } else {
          throw new Error('To enroll in this course, complete your academic profile first: go to Settings and fill in "Academic Information" (program and year level), then try again.');
        }
      }

      // If all checks pass, create a pending enrollment request
      const { error: insertError } = await supabase.from('enrollments').insert({
        student_id: user!.id,
        subject_id: subject.id,
        status: 'pending',
      });
      if (insertError) {
        if (insertError.code === '23505') throw new Error('You already have an enrollment or pending request for this course.');
        throw insertError;
      }
      return subject;
    },
    onSuccess: (subject) => {
      queryClient.invalidateQueries({ queryKey: ['my-enrollments', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['student-program', user?.id] });
      toast.success(`Enrollment request sent for ${subject.code} — ${subject.name}. Waiting for instructor approval.`);
      setEnrollCode('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const leaveCourse = useMutation({
    mutationFn: async (enrollmentId: string) => {
      const { error } = await supabase.from('enrollments').delete().eq('id', enrollmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-enrollments', user?.id] });
      toast.success('Left course');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleEnroll = (e: React.FormEvent) => {
    e.preventDefault();
    enrollByCode.mutate(enrollCode);
  };

  const quickEnroll = useMutation({
    mutationFn: async (subjectId: string) => {
      // First, get the subject details to check restrictions
      const { data: subject, error: findError } = await supabase
        .from('subjects')
        .select('id, code, name, program_id, programs(code, name)')
        .eq('id', subjectId)
        .maybeSingle();
      if (findError) throw findError;
      if (!subject) throw new Error('Course not found.');
      
      // Check if student can enroll based on program restriction
      if (subject.program_id) {
        const { data: studentPrograms, error: programError } = await supabase
          .from('student_programs')
          .select('program_id, year_level, is_irregular, programs(code, name)')
          .eq('student_id', user!.id);
        if (programError) throw programError;
        let studentProgram = studentPrograms?.[0] ?? null;

        // If student has no program record yet but their auth metadata course matches
        // this subject's program code, auto-create a student_programs row for them.
        if (!studentProgram) {
          const metaCourseCode = (user!.user_metadata as any)?.course as string | undefined;
          if (metaCourseCode && subject.programs?.code === metaCourseCode) {
            const { data: created, error: createError } = await supabase
              .from('student_programs')
              .insert({
                student_id: user!.id,
                program_id: subject.program_id,
              })
              .select('program_id, year_level, is_irregular, programs(code, name)')
              .single();
            if (!createError) {
              studentProgram = created;
            }
          }
        }

        // If student has a program record, check if any allows enrollment (irregular or matching program)
        const isIrregular = studentProgram?.is_irregular === true;
        const programMatches = studentProgram && subject.program_id && String(studentProgram.program_id) === String(subject.program_id);
        if (isIrregular || programMatches) {
          // Allow enrollment
        } else if (studentProgram) {
          throw new Error(`This course is only available for ${subject.programs?.code || 'specific program'} students.`);
        } else {
          throw new Error('To enroll in this course, complete your academic profile first: go to Settings and fill in "Academic Information" (program and year level), then try again.');
        }
      }

      // If all checks pass, create a pending enrollment request
      const { error } = await supabase.from('enrollments').insert({
        student_id: user!.id,
        subject_id: subjectId,
        status: 'pending',
      });
      if (error) {
        if (error.code === '23505') throw new Error('You already have an enrollment or pending request for this course.');
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-enrollments', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['student-program', user?.id] });
      toast.success('Enrollment request sent. Waiting for instructor approval.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const enrolledSubjectIds = new Set(
    enrollmentsWithSubjects
      .map((row: any) => row.subject_id)
      .filter(Boolean),
  );
  const pendingOrRejected = enrollmentsWithSubjects.filter(
    (row: any) => row.status && row.status !== 'active',
  );
  const availableSubjects = (allSubjects as any[]).filter(s => !enrolledSubjectIds.has(s.id));

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-display font-bold">My Subjects</h1>

      {role === 'student' && user?.id && studentProgram === null && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="pt-6">
            <p className="text-sm text-amber-800">
              To enroll in program-restricted courses, complete your <strong>Academic Information</strong> first (program and year level).
            </p>
            <Button variant="outline" size="sm" className="mt-3 border-amber-300 text-amber-800 hover:bg-amber-100" asChild>
              <Link to="/dashboard/settings">Go to Settings → Academic profile</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Enroll with course code */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <KeyRound className="h-5 w-5" />
            Enroll with course code
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Ask your instructor for the subject code (e.g. CS101) and enter it below to join the course.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleEnroll} className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="course-code" className="sr-only">Course / subject code</Label>
              <Input
                id="course-code"
                placeholder="e.g. CS101"
                value={enrollCode}
                onChange={(e) => setEnrollCode(e.target.value)}
                className="max-w-xs"
                disabled={enrollByCode.isPending}
              />
            </div>
            <Button type="submit" disabled={enrollByCode.isPending || !enrollCode.trim()}>
              {enrollByCode.isPending ? 'Enrolling...' : 'Enroll'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Browse & enroll from available subjects */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BookOpen className="h-5 w-5" />
            Browse available subjects
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Request enrollment from the list below. Use the code above only if your subject is hidden from this list.
          </p>
        </CardHeader>
        <CardContent>
          {loadingSubjects ? (
            <p className="text-muted-foreground text-sm">Loading subjects...</p>
          ) : availableSubjects.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No additional subjects are currently available to enroll. Ask your instructor for a course code if needed.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {availableSubjects.map((s: any) => {
                const isRestricted = s.program_id;
                return (
                  <Card key={s.id} className={`border-dashed ${isRestricted ? 'border-amber-200 bg-amber-50/50' : ''}`}>
                    <CardContent className="p-4 space-y-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold">{s.code}</p>
                          {isRestricted && (
                            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                              Restricted
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{s.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Instructor: {((s as any).instructor_profile?.full_name ?? '').trim() || (s as any).instructor_profile?.email || '—'}
                        </p>
                        {isRestricted && (
                          <div className="text-xs text-amber-600 mt-1">
                            {s.program_id && <span>{s.programs?.code} only</span>}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 items-center justify-between">
                        <div className="flex gap-2">
                          {s.semester && <Badge variant="secondary">{s.semester}</Badge>}
                          {s.academic_year && <Badge variant="outline">{s.academic_year}</Badge>}
                        </div>
                        <Button
                          size="sm"
                          onClick={() => quickEnroll.mutate(s.id)}
                          disabled={quickEnroll.isPending}
                        >
                          Request
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Enrolled subjects */}
      <Card>
        <CardHeader>
          <CardTitle>Enrolled subjects</CardTitle>
          <p className="text-muted-foreground text-sm">
            Your enrolled subjects and course information.
            {programCode && (
              <>
                {' '}
                Program: <span className="font-medium text-foreground">{programCode}</span>
              </>
            )}
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : enrollmentsWithSubjects.filter((row: any) => row.status === 'active').length === 0 ? (
            <div className="py-12 text-center">
              <BookOpen className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground text-sm">You are not enrolled in any subjects yet.</p>
              <p className="text-muted-foreground text-sm mt-1">Use the course code above to enroll.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {enrollmentsWithSubjects.filter((row: any) => row.status === 'active').map((row: any) => {
                const sub = row.subjects;
                if (!sub) return null;
                return (
                  <Card
                    key={row.id}
                    className="cursor-pointer hover:border-primary/40 transition-colors"
                    onClick={() => navigate(`/dashboard/subjects/${sub.id}`)}
                  >
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <p className="font-semibold">{sub.code}</p>
                          <p className="text-sm text-muted-foreground">{sub.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Instructor: {((sub as any).instructor_profile?.full_name ?? '').trim() || (sub as any).instructor_profile?.email || '—'}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-3">
                        {sub.semester && <Badge variant="secondary">{sub.semester}</Badge>}
                        {sub.academic_year && <Badge variant="outline">{sub.academic_year}</Badge>}
                        <AlertDialog>
                          <AlertDialogTrigger asChild onClick={e => e.stopPropagation()}>
                            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive ml-auto">
                              <LogOut className="h-4 w-4 mr-1" /> Leave
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent onClick={e => e.stopPropagation()}>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Leave course?</AlertDialogTitle>
                              <AlertDialogDescription>
                                You will be removed from {sub.code} — {sub.name}. You can re-enroll later with the course code.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => leaveCourse.mutate(row.id)}>
                                Leave course
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Enrollment requests */}
      {pendingOrRejected.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Enrollment requests</CardTitle>
            <p className="text-muted-foreground text-sm">
              Requests that are waiting for instructor approval or have been decided.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              {pendingOrRejected.map((row: any) => {
                const sub = row.subjects;
                if (!sub) return null;
                const statusLabel =
                  row.status === 'pending'
                    ? 'Pending approval'
                    : row.status === 'rejected'
                      ? 'Rejected'
                      : row.status ?? 'Unknown';
                const statusVariant =
                  row.status === 'pending'
                    ? 'secondary'
                    : row.status === 'rejected'
                      ? 'destructive'
                      : 'outline';
                return (
                  <div
                    key={row.id}
                    className="flex items-center justify-between py-1 border-b border-border/50 last:border-0"
                  >
                    <div>
                      <span className="font-medium">{sub.code}</span>{' '}
                      <span className="text-muted-foreground">— {sub.name}</span>
                    </div>
                    <Badge variant={statusVariant}>{statusLabel}</Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
