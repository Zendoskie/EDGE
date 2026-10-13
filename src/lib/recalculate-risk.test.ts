import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, getSession } = vi.hoisted(() => ({
  invoke: vi.fn(),
  getSession: vi.fn(async () => ({ data: { session: { access_token: 't' } } })),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession },
    functions: { invoke },
  },
}));

import {
  RISK_RECALC_DEBOUNCE_MS,
  flushSubjectRiskRecalc,
  scheduleSubjectRiskRecalc,
} from '@/lib/recalculate-risk';

function deferred() {
  let resolve!: (v: { data: unknown; error: null }) => void;
  const promise = new Promise<{ data: unknown; error: null }>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let n = 0;
const nextSubject = () => `subject-${++n}`;

describe('scheduleSubjectRiskRecalc', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invoke.mockReset();
    invoke.mockResolvedValue({ data: { count: 3 }, error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits ~2.5 s after the last call and runs once for a burst', async () => {
    const subject = nextSubject();
    for (let i = 0; i < 10; i++) {
      scheduleSubjectRiskRecalc(subject);
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(invoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RISK_RECALC_DEBOUNCE_MS - 201);
    expect(invoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('predict-risk', { body: { subject_id: subject } });
  });

  it('never overlaps runs for a subject and queues at most one follow-up', async () => {
    const subject = nextSubject();
    const first = deferred();
    const second = deferred();
    invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    scheduleSubjectRiskRecalc(subject);
    await vi.advanceTimersByTimeAsync(RISK_RECALC_DEBOUNCE_MS);
    expect(invoke).toHaveBeenCalledTimes(1);

    // Two more debounced triggers fire while the first run is still in flight.
    scheduleSubjectRiskRecalc(subject);
    await vi.advanceTimersByTimeAsync(RISK_RECALC_DEBOUNCE_MS);
    scheduleSubjectRiskRecalc(subject);
    await vi.advanceTimersByTimeAsync(RISK_RECALC_DEBOUNCE_MS);
    expect(invoke).toHaveBeenCalledTimes(1);

    first.resolve({ data: { count: 1 }, error: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenCalledTimes(2);

    second.resolve({ data: { count: 1 }, error: null });
    await vi.advanceTimersByTimeAsync(RISK_RECALC_DEBOUNCE_MS * 2);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('ten quick clicks spread across an in-flight run trigger at most two recalculations', async () => {
    const subject = nextSubject();
    const first = deferred();
    invoke.mockReturnValueOnce(first.promise);

    for (let i = 0; i < 10; i++) {
      scheduleSubjectRiskRecalc(subject);
      await vi.advanceTimersByTimeAsync(i === 4 ? RISK_RECALC_DEBOUNCE_MS : 300);
    }
    await vi.advanceTimersByTimeAsync(RISK_RECALC_DEBOUNCE_MS);
    first.resolve({ data: { count: 1 }, error: null });
    await vi.advanceTimersByTimeAsync(RISK_RECALC_DEBOUNCE_MS * 2);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('flush starts the pending run immediately and does not run it again later', async () => {
    const subject = nextSubject();
    scheduleSubjectRiskRecalc(subject);
    flushSubjectRiskRecalc(subject);
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RISK_RECALC_DEBOUNCE_MS * 2);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('flush with nothing pending does nothing', async () => {
    flushSubjectRiskRecalc(nextSubject());
    await vi.advanceTimersByTimeAsync(RISK_RECALC_DEBOUNCE_MS * 2);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('reports the result to the latest callback and keeps subjects independent', async () => {
    const a = nextSubject();
    const b = nextSubject();
    const stale = vi.fn();
    const latest = vi.fn();
    scheduleSubjectRiskRecalc(a, stale);
    scheduleSubjectRiskRecalc(a, latest);
    scheduleSubjectRiskRecalc(b);
    await vi.advanceTimersByTimeAsync(RISK_RECALC_DEBOUNCE_MS);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(stale).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith({ ok: true, count: 3 });
  });

  it('a failed run does not block the next one', async () => {
    const subject = nextSubject();
    invoke.mockRejectedValueOnce(new Error('network'));
    scheduleSubjectRiskRecalc(subject);
    await vi.advanceTimersByTimeAsync(RISK_RECALC_DEBOUNCE_MS);
    scheduleSubjectRiskRecalc(subject);
    await vi.advanceTimersByTimeAsync(RISK_RECALC_DEBOUNCE_MS);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
