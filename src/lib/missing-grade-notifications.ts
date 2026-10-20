import { supabase } from '@/integrations/supabase/client';
import { interpretNotificationInvokeResult } from '@/lib/notification-invoke-result';
import { toast } from 'sonner';

const MISSING_GRADE_EMAIL_FAILED = 'Missing-grade alert saved. The email notification could not be sent.';

export async function publishMissingGradeAlerts(subjectId: string, activityIds: string[]) {
  const uniqueIds = [...new Set(activityIds.filter(Boolean))];
  for (const activityId of uniqueIds) {
    const { data: missingRecipients, error } = await supabase.rpc('notify_missing_activity_grades', {
      p_activity_id: activityId,
    });
    if (error) throw error;
    for (const recipient of missingRecipients ?? []) {
      if (!recipient.email) continue;
      const { data: emailData, error: emailError } = await supabase.functions.invoke('send-notification', {
        body: {
          to: recipient.email,
          student_id: recipient.student_id,
          subject_id: subjectId,
          subject_code: recipient.subject_code || 'EDGE',
          subject_name: recipient.subject_name || 'Course',
          body: recipient.notification_body,
        },
      });
      if (emailError || interpretNotificationInvokeResult(emailData) === 'failed') {
        toast.message(MISSING_GRADE_EMAIL_FAILED);
      }
    }
  }
}

export async function publishMissingGradeAlertsForSubject(subjectId: string) {
  const { data, error } = await supabase.from('activities').select('id').eq('subject_id', subjectId);
  if (error) throw error;
  await publishMissingGradeAlerts(
    subjectId,
    (data ?? []).map((activity) => activity.id),
  );
}
