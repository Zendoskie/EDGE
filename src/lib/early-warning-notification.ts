import { supabase } from '@/integrations/supabase/client';
import { interpretNotificationInvokeResult } from '@/lib/notification-invoke-result';

export const EARLY_WARNING_SAVED_EMAIL_FAILED = 'In-app warning saved, but email failed';

export async function sendEarlyWarningEmail(input: {
  studentEmail: string;
  studentId: string;
  subjectId: string;
  latestRisk: string;
  subjectCode: string;
  subjectName: string;
  message: string;
}): Promise<{ emailError: string | null }> {
  const { data, error } = await supabase.functions.invoke('send-notification', {
    body: {
      to: input.studentEmail,
      student_id: input.studentId,
      subject_id: input.subjectId,
      risk_level: input.latestRisk,
      subject_code: input.subjectCode,
      subject_name: input.subjectName,
      body: input.message,
    },
  });
  if (error) {
    return { emailError: `${EARLY_WARNING_SAVED_EMAIL_FAILED}: ${error.message || 'send error'}` };
  }
  const outcome = interpretNotificationInvokeResult(data);
  if (outcome === 'sent' || outcome === 'duplicate') return { emailError: null };
  return { emailError: EARLY_WARNING_SAVED_EMAIL_FAILED };
}
