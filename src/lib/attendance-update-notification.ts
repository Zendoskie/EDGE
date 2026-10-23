import { supabase } from '@/integrations/supabase/client';
import { interpretNotificationInvokeResult } from '@/lib/notification-invoke-result';

export const ATTENDANCE_UPDATE_EMAIL_FAILED = 'Attendance saved. The student email could not be sent.';

export async function emailAttendanceUpdate(input: {
  studentId: string;
  subjectId: string;
  date: string;
  /** Status returned from record_attendance for this student (committed change). */
  status: string;
}): Promise<{ emailError: string | null; alreadySent: boolean }> {
  const { data, error } = await supabase.functions.invoke('send-notification', {
    body: {
      event: 'attendance_update',
      student_id: input.studentId,
      subject_id: input.subjectId,
      date: input.date,
      status: input.status,
    },
  });
  if (error) return { emailError: ATTENDANCE_UPDATE_EMAIL_FAILED, alreadySent: false };
  const outcome = interpretNotificationInvokeResult(data);
  if (outcome === 'duplicate') return { emailError: null, alreadySent: true };
  if (outcome === 'sent') return { emailError: null, alreadySent: false };
  return { emailError: ATTENDANCE_UPDATE_EMAIL_FAILED, alreadySent: false };
}
