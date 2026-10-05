import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/shell/PageHeader';
import { RiskBadge } from '@/components/RiskBadge';
import { formatFeedbackStatus } from '@/lib/engagement-format';
import { countPendingEngagementFeedback } from '@/lib/instructor-feedback';

type StudentProfile = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  student_id: string | null;
};

type RiskFeedback = {
  id: string;
  created_at: string;
  student_id: string;
  subject_id: string;
  risk_level: string;
  reasons: string[] | null;
  details: string | null;
  instructor_response: string | null;
  student: StudentProfile | null;
  subject: { id: string; code: string | null; name: string | null } | null;
};

type EngagementFeedback = {
  id: string;
  created_at: string;
  student_id: string;
  subject: string | null;
  message: string;
  status: string;
  counselor_remarks: string | null;
  instructor_response: string | null;
  student: StudentProfile | null;
};

function studentLabel(student: StudentProfile | null, fallback?: string) {
  return student?.full_name || student?.email || fallback || 'Student';
}

export function InstructorFeedbackSummary({
  pending,
  total,
}: {
  pending: number;
  total: number;
}) {
  return (
    <Card className="mt-6 bg-card/90 interactive-lift">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-lg">Student Feedback</CardTitle>
          <p className="text-sm text-muted-foreground">
            {pending} Pending
            {total > 0 ? ` · ${total} total` : ''}
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/dashboard/instructor-feedback">Open feedback</Link>
        </Button>
      </CardHeader>
    </Card>
  );
}

export default function InstructorFeedback() {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<
    | { kind: 'risk'; row: RiskFeedback }
    | { kind: 'engagement'; row: EngagementFeedback }
    | null
  >(null);
  const [reply, setReply] = useState('');
  const [savingReply, setSavingReply] = useState(false);

  function openFeedback(next: { kind: 'risk'; row: RiskFeedback } | { kind: 'engagement'; row: EngagementFeedback }) {
    setSelected(next);
    setReply(next.row.instructor_response ?? '');
  }

  async function saveReply() {
    if (!selected) return;
    const response = reply.trim();
    if (!response) return;
    setSavingReply(true);
    const { error } = await supabase.rpc('instructor_reply_to_feedback', {
      p_kind: selected.kind === 'engagement' ? 'engagement' : 'struggle',
      p_feedback_id: selected.row.id,
      p_response: response,
    });
    setSavingReply(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Reply saved');
    if (selected.kind === 'engagement') {
      setSelected({
        kind: 'engagement',
        row: {
          ...selected.row,
          instructor_response: response,
          status: selected.row.status === 'submitted' ? 'reviewed' : selected.row.status,
        },
      });
    } else {
      setSelected({
        kind: 'risk',
        row: { ...selected.row, instructor_response: response },
      });
    }
    await queryClient.invalidateQueries({ queryKey: ['instructor-feedback-page', user?.id] });
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ['instructor-feedback-page', user?.id],
    enabled: !!user?.id && role === 'instructor',
    queryFn: async () => {
      const { data: subjects, error: subjectError } = await supabase
        .from('subjects')
        .select('id, code, name')
        .eq('instructor_id', user!.id);
      if (subjectError) throw subjectError;
      const subjectIds = (subjects ?? []).map((subject) => subject.id);

      const { data: enrollments, error: enrollError } = await supabase
        .from('enrollments')
        .select('student_id, subjects!inner(instructor_id)')
        .eq('subjects.instructor_id', user!.id)
        .eq('status', 'active');
      if (enrollError) throw enrollError;
      const enrolledStudentIds = Array.from(
        new Set((enrollments ?? []).map((row) => row.student_id).filter(Boolean)),
      ) as string[];

      const riskResult = subjectIds.length
        ? await supabase
            .from('student_feedback')
            .select('id, created_at, student_id, subject_id, risk_level, reasons, details, instructor_response')
            .in('subject_id', subjectIds)
            .order('created_at', { ascending: false })
        : { data: [], error: null };
      if (riskResult.error) throw riskResult.error;

      const engagementResult = enrolledStudentIds.length
        ? await supabase
            .from('student_engagement_feedback')
            .select('id, created_at, student_id, subject, message, status, counselor_remarks, instructor_response')
            .in('student_id', enrolledStudentIds)
            .order('created_at', { ascending: false })
        : { data: [], error: null };
      if (engagementResult.error) throw engagementResult.error;

      const profileIds = Array.from(
        new Set(
          [...(riskResult.data ?? []), ...(engagementResult.data ?? [])]
            .map((row) => row.student_id)
            .filter(Boolean),
        ),
      );
      const { data: profiles } = profileIds.length
        ? await supabase
            .from('profiles')
            .select('user_id, full_name, email, student_id')
            .in('user_id', profileIds)
        : { data: [] as StudentProfile[] };
      const profileMap = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
      const subjectMap = new Map((subjects ?? []).map((subject) => [subject.id, subject]));

      const risk = (riskResult.data ?? []).map((row) => ({
        ...row,
        student: profileMap.get(row.student_id) ?? null,
        subject: subjectMap.get(row.subject_id) ?? null,
      })) as RiskFeedback[];
      const engagement = (engagementResult.data ?? []).map((row) => ({
        ...row,
        student: profileMap.get(row.student_id) ?? null,
      })) as EngagementFeedback[];

      return { risk, engagement };
    },
  });

  if (role !== 'instructor') {
    return <p className="p-6 text-sm text-muted-foreground">Instructor feedback is only available for instructor accounts.</p>;
  }

  const risk = data?.risk ?? [];
  const engagement = data?.engagement ?? [];
  const pending = countPendingEngagementFeedback(engagement);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Feedback"
        description="Student feedback for your subjects. Open an item to read the full message."
      />

      {isLoading ? <p className="text-sm text-muted-foreground">Loading feedback...</p> : null}
      {error ? <p className="text-sm text-destructive">Feedback could not be loaded.</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Engagement feedback</CardTitle>
          <p className="text-sm text-muted-foreground">{pending} Pending</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {engagement.length === 0 ? (
            <p className="text-sm text-muted-foreground">No engagement feedback submitted yet.</p>
          ) : (
            engagement.map((item) => (
              <div key={item.id} className="rounded-xl border border-border/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {studentLabel(item.student, item.student_id)} — {item.subject?.trim() || 'General Feedback'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.student?.student_id ?? '—'} · {item.created_at ? new Date(item.created_at).toLocaleString() : ''}
                    </p>
                  </div>
                  <Badge variant="outline">{formatFeedbackStatus(item.status)}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{item.message}</p>
                {item.instructor_response ? (
                  <p className="mt-2 text-sm text-muted-foreground">Reply: {item.instructor_response}</p>
                ) : null}
                <Button className="mt-3" size="sm" variant="outline" onClick={() => openFeedback({ kind: 'engagement', row: item })}>
                  View details
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Struggle feedback</CardTitle>
          <p className="text-sm text-muted-foreground">
            Notes from students explaining a vulnerable or crucial result.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {risk.length === 0 ? (
            <p className="text-sm text-muted-foreground">No struggle feedback submitted yet.</p>
          ) : (
            risk.map((item) => (
              <div key={item.id} className="rounded-xl border border-border/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {studentLabel(item.student, item.student_id)} — {item.subject?.code ?? 'Subject'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.subject?.name ?? ''} · {item.created_at ? new Date(item.created_at).toLocaleString() : ''}
                    </p>
                  </div>
                  <RiskBadge level={item.risk_level} />
                </div>
                {item.instructor_response ? (
                  <p className="mt-2 text-sm text-muted-foreground">Reply: {item.instructor_response}</p>
                ) : null}
                <Button className="mt-3" size="sm" variant="outline" onClick={() => openFeedback({ kind: 'risk', row: item })}>
                  View details
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={selected != null} onOpenChange={(open) => { if (!open) { setSelected(null); setReply(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selected ? studentLabel(selected.row.student, selected.row.student_id) : 'Feedback'}
            </DialogTitle>
            <DialogDescription>
              {selected?.kind === 'engagement'
                ? `${selected.row.subject?.trim() || 'General Feedback'} · ${formatFeedbackStatus(selected.row.status)} · ${new Date(selected.row.created_at).toLocaleString()}`
                : selected
                  ? `${selected.row.subject?.code ?? 'Subject'} · ${new Date(selected.row.created_at).toLocaleString()}`
                  : ''}
            </DialogDescription>
          </DialogHeader>
          {selected?.kind === 'engagement' ? (
            <div className="space-y-3 text-sm">
              <p>{selected.row.message}</p>
              {selected.row.counselor_remarks ? (
                <p className="text-muted-foreground">Counselor remarks: {selected.row.counselor_remarks}</p>
              ) : null}
            </div>
          ) : null}
          {selected?.kind === 'risk' ? (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2">
                {(selected.row.reasons ?? []).map((reason) => (
                  <Badge key={reason} variant="outline">{reason}</Badge>
                ))}
              </div>
              {selected.row.details ? <p>{selected.row.details}</p> : null}
              <Button asChild size="sm" variant="outline">
                <Link to={`/dashboard/subjects/${selected.row.subject_id}`}>Open subject</Link>
              </Button>
            </div>
          ) : null}
          {selected ? (
            <div className="space-y-2">
              <Label htmlFor="instructor-reply">Reply</Label>
              <Textarea
                id="instructor-reply"
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                placeholder="Write a reply for this student"
              />
              <Button size="sm" disabled={savingReply || !reply.trim()} onClick={() => void saveReply()}>
                {savingReply ? 'Saving…' : 'Save reply'}
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
