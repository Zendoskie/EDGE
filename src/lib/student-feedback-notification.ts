import { supabase } from '@/integrations/supabase/client';
import { interpretNotificationInvokeResult } from '@/lib/notification-invoke-result';

export async function submitRiskFeedback(input: {
  studentId: string;
  subjectId: string;
  predictionId: string | null;
  riskLevel: string;
  reasons: string[];
  details: string | null;
}): Promise<{ id: string; emailError: string | null }> {
  const { data, error } = await supabase
    .from('student_feedback')
    .insert({
      student_id: input.studentId,
      subject_id: input.subjectId,
      prediction_id: input.predictionId,
      risk_level: input.riskLevel,
      reasons: input.reasons,
      details: input.details,
    })
    .select('id')
    .single();
  if (error) throw error;

  const { data: emailData, error: emailError } = await supabase.functions.invoke('send-notification', {
    body: {
      event: 'risk_feedback',
      feedback_id: data.id,
    },
  });
  if (emailError) {
    return { id: data.id, emailError: 'Feedback saved. The instructor email could not be sent.' };
  }
  if (emailData?.skipped) {
    return {
      id: data.id,
      emailError: 'Feedback saved. No subject instructor could be determined, so no email was sent.',
    };
  }
  if (interpretNotificationInvokeResult(emailData) !== 'sent') {
    return { id: data.id, emailError: 'Feedback saved. The instructor email could not be sent.' };
  }
  return { id: data.id, emailError: null };
}

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
  if (interpretNotificationInvokeResult(emailData) !== 'sent') {
    return { id: data.id, emailError: 'Feedback saved. The instructor email could not be sent.' };
  }
  return { id: data.id, emailError: null };
}
