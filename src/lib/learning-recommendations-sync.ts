import { supabase } from '@/integrations/supabase/client';
import { canonicalRiskLevel } from '@/lib/risk-utils';

export type SyncRecommendationsResult =
  | { status: 'skipped'; reason: string }
  | { status: 'synced'; inserted: number }
  | { status: 'failed'; message: string };

const AT_RISK_BANDS = new Set(['vulnerable', 'crucial']);

/**
 * Persist heuristic study recommendations for at-risk students.
 * Uses generate_learning_recommendations (DB metrics) — not a separate AI reclassification.
 */
export async function syncLearningRecommendationsForStudent(
  studentId: string,
  riskLevel: string | null | undefined,
): Promise<SyncRecommendationsResult> {
  const level = canonicalRiskLevel(riskLevel);
  const band = level === 'at_risk' ? 'vulnerable' : level === 'critical' ? 'crucial' : level;
  if (!AT_RISK_BANDS.has(band)) {
    return { status: 'skipped', reason: 'not_at_risk' };
  }

  const { data: inserted, error } = await supabase.rpc('sync_learning_recommendations_for_student', {
    p_student_id: studentId,
  });
  if (error) {
    if (error.message.includes('Could not find the function') || error.code === '42883') {
      return { status: 'failed', message: 'recommendation_sync_not_deployed' };
    }
    return { status: 'failed', message: error.message };
  }
  const count = typeof inserted === 'number' ? inserted : 0;
  if (count === 0) return { status: 'skipped', reason: `no_new_rows:${band}` };
  return { status: 'synced', inserted: count };
}
