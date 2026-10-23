import { supabase } from '@/integrations/supabase/client';
import { interpretNotificationInvokeResult } from '@/lib/notification-invoke-result';

export type ReferralNotificationEvent = 'referral_created' | 'referral_decided';

export const REFERRAL_SAVED_EMAIL_FAILED = 'Referral saved. The notification email could not be sent.';
export const REFERRAL_SAVED_EMAIL_PARTIAL = 'Referral saved. Some notification emails could not be sent.';

export type ReferralEmailOutcome = {
  emailError: string | null;
  alreadySent: boolean;
};

function referralEmailOutcomeFromData(data: unknown): ReferralEmailOutcome {
  if (!data || typeof data !== 'object') {
    return { emailError: REFERRAL_SAVED_EMAIL_FAILED, alreadySent: false };
  }
  const body = data as Record<string, unknown>;
  const sent = typeof body.sent === 'number' ? body.sent : 0;
  const failed = typeof body.failed === 'number' ? body.failed : 0;

  const outcome = interpretNotificationInvokeResult(data);
  if (outcome === 'duplicate') return { emailError: null, alreadySent: true };
  if (outcome === 'sent') return { emailError: null, alreadySent: false };
  if (sent >= 1 && failed > 0) {
    return { emailError: REFERRAL_SAVED_EMAIL_PARTIAL, alreadySent: false };
  }
  return { emailError: REFERRAL_SAVED_EMAIL_FAILED, alreadySent: false };
}

export async function sendReferralNotification(opts: {
  event: ReferralNotificationEvent;
  referralId: string;
  counselorRemarks?: string | null;
}): Promise<ReferralEmailOutcome> {
  const { data, error } = await supabase.functions.invoke('send-referral-notification', {
    body: {
      event: opts.event,
      referral_id: opts.referralId,
      counselor_remarks: opts.counselorRemarks ?? null,
    },
  });

  if (error) {
    return { emailError: REFERRAL_SAVED_EMAIL_FAILED, alreadySent: false };
  }
  return referralEmailOutcomeFromData(data);
}
