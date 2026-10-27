import { supabase } from '@/integrations/supabase/client';
import type { MissingItem, ReleaseOutcome } from '../../supabase/functions/_shared/final-grade-release.ts';

export type ReleaseResponse = {
  subject_id: string;
  outcome: ReleaseOutcome;
  released: number;
  unchanged: number;
  incomplete: Array<{ student_id: string; missing: MissingItem[] }>;
  not_enrolled: string[];
};

export type ReleaseCallResult =
  | { kind: 'ok'; body: ReleaseResponse }
  | { kind: 'conflict'; message: string }
  | { kind: 'error'; message: string };

const OUTCOMES: readonly string[] = ['all_released', 'partial', 'none_released'];

export const RELEASE_CONFLICT_FALLBACK =
  'Grades, attendance, assessments or weights changed while the release was running. Nothing was released. Recheck the gradebook and release again.';

function parseReleaseBody(data: unknown): ReleaseResponse | null {
  if (!data || typeof data !== 'object') return null;
  const b = data as Record<string, unknown>;
  if (typeof b.outcome !== 'string' || !OUTCOMES.includes(b.outcome)) return null;
  if (typeof b.released !== 'number' || !Number.isFinite(b.released)) return null;
  if (typeof b.unchanged !== 'number' || !Number.isFinite(b.unchanged)) return null;
  if (!Array.isArray(b.incomplete) || !Array.isArray(b.not_enrolled)) return null;
  const incompleteOk = b.incomplete.every(
    (row) => !!row && typeof (row as { student_id?: unknown }).student_id === 'string' &&
      Array.isArray((row as { missing?: unknown }).missing),
  );
  if (!incompleteOk || !b.not_enrolled.every((id) => typeof id === 'string')) return null;
  return data as ReleaseResponse;
}

export type InvokeReleaseOptions = {
  /** Inclusion whitelist; only these enrolled students are evaluated and released. */
  studentIds?: string[];
};

/** One call to release-final-grades. Never retries: a stale release must be rechecked by the instructor. */
export async function invokeReleaseFinalGrades(
  subjectId: string,
  options?: InvokeReleaseOptions,
): Promise<ReleaseCallResult> {
  const requestBody: { subject_id: string; student_ids?: string[] } = { subject_id: subjectId };
  if (options?.studentIds) requestBody.student_ids = options.studentIds;

  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await supabase.functions.invoke('release-final-grades', { body: requestBody }));
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'The release request failed.' };
  }

  if (error) {
    let message = error instanceof Error ? error.message : 'The release request failed.';
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const j = (await ctx.clone().json()) as { error?: string; message?: string };
        if (ctx.status === 409 && j?.error === 'inputs_changed') {
          return { kind: 'conflict', message: j.message || RELEASE_CONFLICT_FALLBACK };
        }
        if (j?.error === 'Unauthorized') {
          message = 'Your sign-in session expired. Sign in again, then release final grades.';
        } else if (j?.error) message = j.error;
      } catch {
        /* keep message */
      }
    }
    return { kind: 'error', message };
  }

  const body = parseReleaseBody(data);
  if (!body) return { kind: 'error', message: 'The server returned an unexpected response. Nothing is shown as released.' };
  return { kind: 'ok', body };
}
