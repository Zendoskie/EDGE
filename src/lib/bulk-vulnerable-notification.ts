import { supabase } from '@/integrations/supabase/client';
import { parseBulkNotificationInvokeResult } from '@/lib/notification-invoke-result';

export type BulkVulnerableRecipient = {
  to: string;
  student_id: string;
  subject_id: string;
  risk_level: string;
};

export type BulkVulnerableNotificationResult =
  | { kind: 'invoke_error'; message: string }
  | { kind: 'invalid_response' }
  | {
      kind: 'bulk';
      sent: number;
      failed: number;
      total: number;
      errors: Array<{ index: number; message: string }>;
    };

export async function sendBulkVulnerableNotifications(input: {
  subjectCode: string;
  subjectName: string;
  body: string;
  recipients: BulkVulnerableRecipient[];
}): Promise<BulkVulnerableNotificationResult> {
  const { data, error } = await supabase.functions.invoke('send-notification', {
    body: {
      subject_code: input.subjectCode,
      subject_name: input.subjectName,
      body: input.body,
      recipients: input.recipients,
    },
  });
  if (error) {
    return { kind: 'invoke_error', message: error.message || 'Failed to send emails' };
  }
  const parsed = parseBulkNotificationInvokeResult(data);
  if (!parsed.valid) return { kind: 'invalid_response' };
  return {
    kind: 'bulk',
    sent: parsed.sent,
    failed: parsed.failed,
    total: input.recipients.length,
    errors: parsed.errors,
  };
}
