import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { sendReferralNotification } from '@/lib/referral-notifications';
import { HeartHandshake } from 'lucide-react';

type Props = {
  studentId: string;
  studentName: string;
  engagementLevel: string;
  engagementScore: number;
};

/**
 * Lets a guidance counselor open a pending counseling referral from engagement context.
 * Uses an enrolled subject + that subject's instructor (required by schema).
 */
export function GuidanceEngagementReferralButton({
  studentId,
  studentName,
  engagementLevel,
  engagementScore,
}: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [note, setNote] = useState(
    `Engagement follow-up: ${studentName} shows ${engagementLevel.replace('_', ' ')} engagement (score ${Math.round(engagementScore)}). Recommend guidance check-in.`,
  );
  const [open, setOpen] = useState(false);

  const createReferral = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error('Not signed in');

      const { data: enrollments, error: enrollError } = await supabase
        .from('enrollments')
        .select('subject_id')
        .eq('student_id', studentId)
        .eq('status', 'active')
        .limit(10);
      if (enrollError) throw enrollError;

      const subjectIds = (enrollments ?? []).map((e) => e.subject_id).filter(Boolean);
      if (subjectIds.length === 0) {
        throw new Error('Student has no active subject enrollment to attach a referral.');
      }

      const { data: subjects, error: subjectsError } = await supabase
        .from('subjects')
        .select('id, instructor_id, code, name')
        .in('id', subjectIds);
      if (subjectsError) throw subjectsError;

      const subject = (subjects ?? []).find((s) => s.instructor_id);
      if (!subject?.instructor_id) {
        throw new Error('Could not find an instructor for this student’s subjects.');
      }

      const { data: pending } = await supabase
        .from('counseling_referrals')
        .select('id')
        .eq('student_id', studentId)
        .eq('subject_id', subject.id)
        .eq('status', 'pending')
        .maybeSingle();
      if (pending) {
        throw new Error('A pending counseling referral already exists for this student in that subject.');
      }

      const message =
        note.trim() ||
        `Engagement-based guidance referral for ${studentName} (${subject.code ?? 'subject'}).`;

      const { data: inserted, error } = await supabase
        .from('counseling_referrals')
        .insert({
          student_id: studentId,
          subject_id: subject.id,
          instructor_id: subject.instructor_id,
          recommendation_message: message,
          status: 'pending',
          prediction_id: null,
        })
        .select('id')
        .single();
      if (error) throw error;

      await sendReferralNotification({
        event: 'referral_created',
        referralId: inserted.id,
      });

      return inserted.id;
    },
    onSuccess: () => {
      toast.success('Counseling referral created from engagement review.');
      void queryClient.invalidateQueries({ queryKey: ['guidance-referrals'] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!open) {
    return (
      <Button type="button" variant="secondary" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <HeartHandshake className="h-4 w-4" />
        Open counseling referral
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border/70 p-3 bg-muted/30">
      <Label htmlFor="guidance-eng-referral-note">Referral note</Label>
      <Textarea
        id="guidance-eng-referral-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        className="text-sm"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={createReferral.isPending}
          onClick={() => createReferral.mutate()}
        >
          {createReferral.isPending ? 'Submitting…' : 'Submit referral'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
