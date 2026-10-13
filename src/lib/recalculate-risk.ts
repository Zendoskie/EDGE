import { supabase } from '@/integrations/supabase/client';

export type RiskRecalcResult = { ok: boolean; count?: number; error?: string };

/** Silently recalculate rule-based risk scores for all students in a subject. */
export async function recalculateSubjectRisk(subjectId: string): Promise<RiskRecalcResult> {
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

export const RISK_RECALC_DEBOUNCE_MS = 2500;

type RecalcState = {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  queued: boolean;
  onDone?: (result: RiskRecalcResult) => void;
};

const recalcStates = new Map<string, RecalcState>();

async function runSubjectRiskRecalc(subjectId: string): Promise<void> {
  const state = recalcStates.get(subjectId);
  if (!state) return;
  if (state.running) {
    state.queued = true;
    return;
  }
  state.running = true;
  try {
    const result = await recalculateSubjectRisk(subjectId);
    state.onDone?.(result);
  } catch {
    /* recalculation is best-effort; the next attendance change schedules another run */
  } finally {
    state.running = false;
    if (state.queued) {
      state.queued = false;
      void runSubjectRiskRecalc(subjectId);
    } else if (!state.timer) {
      recalcStates.delete(subjectId);
    }
  }
}

/**
 * Debounced, single-flight risk recalculation per subject: starts ~2.5 s after the last call,
 * never runs two at once for a subject in this tab, and queues at most one follow-up.
 * Separate tabs or devices are not coordinated.
 */
export function scheduleSubjectRiskRecalc(
  subjectId: string,
  onDone?: (result: RiskRecalcResult) => void,
): void {
  const state = recalcStates.get(subjectId) ?? { timer: null, running: false, queued: false };
  recalcStates.set(subjectId, state);
  state.onDone = onDone;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    void runSubjectRiskRecalc(subjectId);
  }, RISK_RECALC_DEBOUNCE_MS);
}

/** Start a pending scheduled recalculation now (e.g. on unmount) so the last changes are not lost. */
export function flushSubjectRiskRecalc(subjectId: string): void {
  const state = recalcStates.get(subjectId);
  if (!state?.timer) return;
  clearTimeout(state.timer);
  state.timer = null;
  void runSubjectRiskRecalc(subjectId);
}
