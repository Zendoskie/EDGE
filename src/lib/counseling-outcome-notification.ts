import { supabase } from '@/integrations/supabase/client';
import { interpretNotificationInvokeResult } from '@/lib/notification-invoke-result';
import { shouldSendCounselingOutcomeEmail } from '../../supabase/functions/_shared/notification-channels';

export { shouldSendCounselingOutcomeEmail };

export const OUTCOME_SAVED_EMAIL_SENT = 'Outcome saved. The student email was sent.';
export const OUTCOME_SAVED_EMAIL_FAILED = 'Outcome saved. The student email was not sent.';
export const OUTCOME_EMAIL_ALREADY_SENT = 'Outcome saved. The student email was already sent.';

export type OutcomeEmailResult = {
  emailError: string | null;
  alreadySent: boolean;
};

async function invokeOutcomeEmail(
  actionType: string,
  actorRole: string,
  interventionId: string,
): Promise<OutcomeEmailResult> {
  const useCounselorChannel = shouldSendCounselingOutcomeEmail(actionType, actorRole);
  const { data: emailData, error: emailError } = useCounselorChannel
    ? await supabase.functions.invoke('send-referral-notification', {
        body: { event: 'counseling_outcome', intervention_id: interventionId },
      })
    : await supabase.functions.invoke('send-notification', {
        body: { event: 'engagement_outcome', intervention_id: interventionId },
      });
  if (emailError) return { emailError: OUTCOME_SAVED_EMAIL_FAILED, alreadySent: false };
  const outcome = interpretNotificationInvokeResult(emailData);
  if (outcome === 'duplicate') return { emailError: null, alreadySent: true };
  if (outcome === 'sent') return { emailError: null, alreadySent: false };
  return { emailError: OUTCOME_SAVED_EMAIL_FAILED, alreadySent: false };
}

/** Email only. Does not complete the outcome or write another inbox row. */
export async function retryCounselingOutcomeEmail(
  interventionId: string,
  actionType: string,
  actorRole: string,
): Promise<OutcomeEmailResult> {
  return invokeOutcomeEmail(actionType, actorRole, interventionId);
}

export function canRetryOutcomeEmail(
  item: {
    status: string;
    action_type: string;
    actor_role: string;
    instructor_id: string;
    completed_by: string | null;
  },
  userId: string | undefined,
): boolean {
  if (!userId || item.status !== 'completed') return false;
  return userId === item.instructor_id || userId === item.completed_by;
}

export async function recordCounselingOutcome(input: {
  interventionId: string;
  outcomeRating: string;
  outcomeNote?: string;
  actionType: string;
  actorRole: string;
}): Promise<{ id: string; emailError: string | null; alreadySent: boolean }> {
  const { data, error } = await supabase.rpc('complete_engagement_intervention', {
    p_intervention_id: input.interventionId,
    p_outcome_rating: input.outcomeRating,
    p_outcome_note: input.outcomeNote?.trim() || undefined,
  });
  if (error) throw error;

  const id = data as string;
  const email = await invokeOutcomeEmail(input.actionType, input.actorRole, input.interventionId);
  return { id, emailError: email.emailError, alreadySent: email.alreadySent };
}
