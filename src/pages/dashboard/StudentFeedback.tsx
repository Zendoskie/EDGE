import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { formatFeedbackStatus, formatLastLogin } from '@/lib/engagement-format';

type FeedbackRow = {
  id: string;
  subject: string | null;
  message: string;
  status: string;
  counselor_remarks: string | null;
  created_at: string;
};

export default function StudentFeedback() {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const { data: feedback = [], isLoading } = useQuery({
    queryKey: ['student-engagement-feedback', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_engagement_feedback')
        .select('id, subject, message, status, counselor_remarks, created_at')
        .eq('student_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as FeedbackRow[];
    },
    enabled: !!user?.id && role === 'student',
    refetchOnWindowFocus: true,
  });

  const submitFeedback = useMutation({
    mutationFn: async () => {
      const trimmed = message.trim();
      if (!trimmed) throw new Error('Feedback message is required.');

      const { error } = await supabase.from('student_engagement_feedback').insert({
        student_id: user!.id,
        subject: subject.trim() || null,
        message: trimmed,
        status: 'submitted',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Feedback submitted successfully.');
      setSubject('');
      setMessage('');
      void queryClient.invalidateQueries({ queryKey: ['student-engagement-feedback', user?.id] });
      void queryClient.invalidateQueries({ queryKey: ['student-engagement-feedback-latest', user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (role !== 'student') {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Student feedback is only available for student accounts.
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <section className="page-section overflow-hidden">
        <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
          <div>
            <h1 className="text-2xl font-display font-bold">Feedback</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Share your learning experience, academic concerns, or suggestions for improvement.
            </p>
          </div>
        </div>
      </section>

      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Submit Feedback
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submitFeedback.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="feedback-subject">Subject (optional)</Label>
              <Input
                id="feedback-subject"
                placeholder="e.g. Academic Concern, Laboratory Activities"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="feedback-message">Feedback Message (required)</Label>
              <Textarea
                id="feedback-message"
                placeholder="Describe your concern, difficulty, or suggestion..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="min-h-[120px]"
                required
              />
            </div>
            <Button type="submit" disabled={submitFeedback.isPending || !message.trim()}>
              {submitFeedback.isPending ? 'Submitting…' : 'Submit Feedback'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle className="text-lg">Your Feedback History</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading feedback…</p>
          ) : feedback.length === 0 ? (
            <p className="text-sm text-muted-foreground">No feedback submitted yet.</p>
          ) : (
            <div className="space-y-3">
              {feedback.map((item) => (
                <div key={item.id} className="rounded-xl border border-border/60 p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{item.subject?.trim() || 'General Feedback'}</p>
                    <Badge variant="outline">{formatFeedbackStatus(item.status)}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{item.message}</p>
                  <p className="text-xs text-muted-foreground">Submitted: {formatLastLogin(item.created_at)}</p>
                  {item.counselor_remarks ? (
                    <p className="text-xs text-muted-foreground">Counselor remarks: {item.counselor_remarks}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
