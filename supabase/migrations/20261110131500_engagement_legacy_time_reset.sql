-- Follow-up to 20261110130000_engagement_active_time_and_periods.sql
--
-- 1. Pre-fix sessions have no measured active time. The first migration tried to
--    reconstruct it from activity timestamps, but an abandoned tab could span
--    weeks, so sessions were still credited up to the 4 hour cap. That is not
--    accurate, and the summary rows still held the original wall-clock totals
--    (hundreds of hours). This migration drops unverifiable legacy time instead
--    of inventing it: logins, activity, assignments, AI sessions, and feedback
--    history are untouched. Measured time starts with the new heartbeat tracker.
--
-- 2. Recompute every summary once with the alert evaluator suppressed, so the
--    corrected numbers do not emit campus-wide "engagement score dropped"
--    alerts. The suppression flag is transaction-local and the wrapper simply
--    forwards to the original evaluator when it is off.

-- ── 1. Drop unverifiable legacy time ─────────────────────────────────────────
-- Any row with measured time has last_heartbeat_at set by touch_student_session,
-- so this only touches pre-fix rows (and brand-new rows that have not beaten yet).
UPDATE public.student_login_history
SET active_seconds = 0,
    session_duration = 0
WHERE last_heartbeat_at IS NULL;

-- ── 2. Suppress alerts during maintenance recomputes ─────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'evaluate_engagement_alerts'
      AND pronamespace = 'public'::regnamespace
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'evaluate_engagement_alerts_impl'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    ALTER FUNCTION public.evaluate_engagement_alerts(UUID) RENAME TO evaluate_engagement_alerts_impl;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.evaluate_engagement_alerts(p_student_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Set by maintenance scripts/migrations: edge.suppress_engagement_alerts = 'on'.
  IF COALESCE(current_setting('edge.suppress_engagement_alerts', true), 'off') = 'on' THEN
    RETURN;
  END IF;

  PERFORM public.evaluate_engagement_alerts_impl(p_student_id);
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_engagement_alerts(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.evaluate_engagement_alerts(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.evaluate_engagement_alerts_impl(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_engagement_alerts_impl(UUID) TO service_role;

-- ── 3. Recompute summaries with the corrected time, silently ─────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  PERFORM set_config('edge.suppress_engagement_alerts', 'on', true);

  FOR r IN SELECT student_id FROM public.student_engagement_summary LOOP
    PERFORM public.recompute_student_engagement_internal(r.student_id);
  END LOOP;

  PERFORM set_config('edge.suppress_engagement_alerts', 'off', true);
END;
$$;

-- The old previous-score values would otherwise fire a delayed drop alert on the
-- next ordinary recompute. Clear them; the next real change establishes a new
-- comparison point.
UPDATE public.student_engagement_summary
SET previous_engagement_level = NULL,
    previous_engagement_score = NULL
WHERE previous_engagement_level IS NOT NULL
   OR previous_engagement_score IS NOT NULL;
