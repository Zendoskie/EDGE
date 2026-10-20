import { supabase } from '@/integrations/supabase/client';
import { interpretNotificationInvokeResult } from '@/lib/notification-invoke-result';

export type ReferralNotificationEvent = 'referral_created' | 'referral_decided';

export async function sendReferralNotification(opts: {
  event: ReferralNotificationEvent;
  referralId: string;
  counselorRemarks?: string | null;
}): Promise<void> {
  const { data, error } = await supabase.functions.invoke('send-referral-notification', {
    body: {
      event: opts.event,
      referral_id: opts.referralId,
      counselor_remarks: opts.counselorRemarks ?? null,
    },
  });

  if (error) {
    console.warn('send-referral-notification failed:', error.message);
    return;
  }
  const outcome = interpretNotificationInvokeResult(data);
  if (outcome === 'failed') {
    console.warn('send-referral-notification did not deliver email:', data);
  }
}
