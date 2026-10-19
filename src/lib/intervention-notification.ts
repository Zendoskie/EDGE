import { supabase } from '@/integrations/supabase/client';

export const INTERVENTION_SAVED_EMAIL_FAILED = 'Intervention saved. The student email could not be sent.';

async function sendInterventionEmail(
  event: 'engagement_intervention' | 'logged_intervention',
  interventionId: string,
): Promise<{ emailError: string | null; alreadySent: boolean }> {
  const { data, error } = await supabase.functions.invoke('send-notification', {
    body: { event, intervention_id: interventionId },
  });
  if (error) return { emailError: INTERVENTION_SAVED_EMAIL_FAILED, alreadySent: false };
  if (data?.duplicate) return { emailError: null, alreadySent: true };
  const failed = typeof data?.failed === 'number' ? data.failed : 0;
  if (failed > 0 || data?.skipped) return { emailError: INTERVENTION_SAVED_EMAIL_FAILED, alreadySent: false };
  return { emailError: null, alreadySent: false };
}

/** Email only. Does not log another intervention or inbox row. */
export function emailEngagementIntervention(interventionId: string) {
  return sendInterventionEmail('engagement_intervention', interventionId);
}

/** Email only. Does not insert another intervention or inbox row. */
export function emailLoggedIntervention(interventionId: string) {
  return sendInterventionEmail('logged_intervention', interventionId);
}

/** Email only. Does not call log/complete RPCs or write another inbox row. */
export async function emailCounselorFollowup(
  interventionId: string,
): Promise<{ emailError: string | null; alreadySent: boolean }> {
  const { data, error } = await supabase.functions.invoke('send-referral-notification', {
    body: { event: 'counselor_followup', intervention_id: interventionId },
  });
  if (error) return { emailError: INTERVENTION_SAVED_EMAIL_FAILED, alreadySent: false };
  if (data?.duplicate) return { emailError: null, alreadySent: true };
  const failed = typeof data?.failed === 'number' ? data.failed : 0;
  if (failed > 0 || data?.skipped) return { emailError: INTERVENTION_SAVED_EMAIL_FAILED, alreadySent: false };
  return { emailError: null, alreadySent: false };
}

export function canRetryCounselorFollowupEmail(
  item: {
    status: string;
    action_type: string;
    actor_role: string;
    instructor_id: string;
  },
  userId: string | undefined,
): boolean {
  if (!userId || item.status !== 'open') return false;
  if (item.action_type !== 'guidance_counseling') return false;
  if (item.actor_role !== 'guidance_counselor') return false;
  return userId === item.instructor_id;
}
