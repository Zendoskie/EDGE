import { supabase } from '@/integrations/supabase/client';

export async function submitEngagementFeedback(input: {
  studentId: string;
  subject: string | null;
  message: string;
}): Promise<{ id: string; emailError: string | null }> {
  const message = input.message.trim();
  if (!message) throw new Error('Feedback message is required.');

  const { data, error } = await supabase
    .from('student_engagement_feedback')
    .insert({
      student_id: input.studentId,
      subject: input.subject?.trim() || null,
      message,
      status: 'submitted',
    })
    .select('id')
    .single();
  if (error) throw error;

  const { data: emailData, error: emailError } = await supabase.functions.invoke('send-notification', {
    body: {
      event: 'instructor_feedback',
      feedback_id: data.id,
    },
  });
  if (emailError) {
    return { id: data.id, emailError: 'Feedback saved. The instructor email could not be sent.' };
  }
  if (emailData?.skipped) {
    return {
      id: data.id,
      emailError: 'Feedback saved. No single subject instructor could be determined, so no email was sent.',
    };
  }
  const failed = typeof emailData?.failed === 'number' ? emailData.failed : 0;
  if (failed > 0) {
    return { id: data.id, emailError: 'Feedback saved. The instructor email could not be sent.' };
  }
  return { id: data.id, emailError: null };
}
