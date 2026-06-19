import { supabase } from '@/integrations/supabase/client';

/** Silently recalculate rule-based risk scores for all students in a subject. */
export async function recalculateSubjectRisk(subjectId: string): Promise<{ ok: boolean; count?: number; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: 'Not authenticated' };

  const { data, error } = await supabase.functions.invoke('predict-risk', {
    body: { subject_id: subjectId },
  });

  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const j = (await ctx.clone().json()) as { error?: string };
        if (j?.error) msg = j.error;
      } catch {
        /* use msg */
      }
    }
    return { ok: false, error: msg };
  }

  if (data && typeof data === 'object' && 'error' in data && (data as { error?: string }).error) {
    return { ok: false, error: String((data as { error: string }).error) };
  }

  return { ok: true, count: (data as { count?: number })?.count };
}
