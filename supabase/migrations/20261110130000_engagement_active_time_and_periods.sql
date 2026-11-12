-- Accurate engagement time, per-period time spent, and parent check-in engagement.
--
-- Why this migration exists
-- -------------------------
-- Session time used to be derived from the wall clock (now() - login_time). A tab
-- left open, or a session that was never finalized, therefore counted idle or
-- away hours as "time spent" — a four minute visit could grow into an hour.
--
-- Time is now accumulated from explicit heartbeats:
--   * the client sends a heartbeat only while the tab is visible and the user has
--     interacted recently (client-side idle cut-off),
--   * the server credits at most 90 seconds per heartbeat, so a long pause can
--     never be counted in one jump,
--   * `student_daily_time` keeps the credited seconds per local reporting day
--     (Asia/Manila). The Today / Yesterday / This week / This month filters read
--     this table, so a continuing session no longer inflates earlier periods.
--
-- Legacy rows (last_heartbeat_at IS NULL) were recorded with the wall clock.
-- Their active time is reconstructed from the timestamps of tracked student
-- activity inside the session, capped by the elapsed wall clock and by 4 hours.
-- Sessions that were still open are closed so they cannot keep growing.
--
-- NOTE: 20261110131500_engagement_legacy_time_reset.sql supersedes that estimate:
-- an abandoned tab can span weeks, so the reconstruction still credits too much.
-- The follow-up resets unverifiable legacy time to zero and recomputes summaries
-- with alerts suppressed. Keep both migrations; the final state is what matters.

-- ── 1. Active-time columns on the session log ────────────────────────────────
ALTER TABLE public.student_login_history
  ADD COLUMN IF NOT EXISTS active_seconds INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;

COMMENT ON COLUMN public.student_login_history.active_seconds IS
  'Measured active seconds. Heartbeat deltas are capped at 90s; idle and hidden-tab time is excluded.';
COMMENT ON COLUMN public.student_login_history.last_heartbeat_at IS
  'Last heartbeat credited for this session. NULL marks a pre-fix (wall-clock) row.';

-- The one-time backfill below must not fire the engagement trigger per row:
-- that would recompute every summary mid-migration and could create spurious
-- "engagement score dropped" / level-change alerts from the corrected numbers.
ALTER TABLE public.student_login_history
  DISABLE TRIGGER student_login_history_recompute_engagement;

-- ── 2. Reconstruct a conservative estimate for wall-clock (legacy) rows ──────
WITH estimates AS (
  SELECT
    h.id,
    LEAST(
      14400,
      GREATEST(
        0,
        LEAST(
          GREATEST(
            0,
            FLOOR(EXTRACT(EPOCH FROM (COALESCE(h.logout_time, now()) - h.login_time)))::INTEGER
          ),
          GREATEST(
            60,
            COALESCE(
              (
                SELECT FLOOR(EXTRACT(EPOCH FROM (MAX(a.created_at) - h.login_time)))::INTEGER
                FROM public.student_activity a
                WHERE a.student_id = h.student_id
                  AND a.created_at >= h.login_time
                  AND a.created_at <= COALESCE(h.logout_time, now())
              ),
              0
            )
          )
        )
      )
    ) AS seconds
  FROM public.student_login_history h
  WHERE h.last_heartbeat_at IS NULL
)
UPDATE public.student_login_history h
SET active_seconds = e.seconds,
    session_duration = e.seconds
FROM estimates e
WHERE h.id = e.id;

-- Close sessions that were left open by the old tracker so they stop accruing.
UPDATE public.student_login_history
SET logout_time = LEAST(now(), login_time + make_interval(secs => active_seconds))
WHERE logout_time IS NULL
  AND last_heartbeat_at IS NULL;

ALTER TABLE public.student_login_history
  ENABLE TRIGGER student_login_history_recompute_engagement;

-- ── 3. Per-day active time (drives the period filters) ───────────────────────
CREATE TABLE IF NOT EXISTS public.student_daily_time (
  student_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  active_seconds INTEGER NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, day)
);

CREATE INDEX IF NOT EXISTS student_daily_time_day_idx
  ON public.student_daily_time (day DESC);

COMMENT ON TABLE public.student_daily_time IS
  'Active seconds per student per local reporting day (Asia/Manila). Written only through the session RPCs.';

ALTER TABLE public.student_daily_time ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students view own daily time" ON public.student_daily_time;
CREATE POLICY "Students view own daily time" ON public.student_daily_time
  FOR SELECT USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "Parents view linked student daily time" ON public.student_daily_time;
CREATE POLICY "Parents view linked student daily time" ON public.student_daily_time
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.parent_student_links psl
      WHERE psl.parent_user_id = auth.uid()
        AND psl.student_user_id = student_daily_time.student_id
        AND psl.status = 'approved'
    )
  );

DROP POLICY IF EXISTS "Instructors view student daily time" ON public.student_daily_time;
CREATE POLICY "Instructors view student daily time" ON public.student_daily_time
  FOR SELECT USING (public.instructor_can_view_student(student_id));

DROP POLICY IF EXISTS "Admins view all daily time" ON public.student_daily_time;
CREATE POLICY "Admins view all daily time" ON public.student_daily_time
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));

GRANT SELECT ON public.student_daily_time TO authenticated;

-- ── 4. Session lifecycle RPCs ────────────────────────────────────────────────
-- A new login always closes the previous open session for that student, so a
-- stale session can never be resumed and credited for the time in between.
CREATE OR REPLACE FUNCTION public.close_open_login_sessions_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.student_login_history
  SET logout_time = GREATEST(login_time, LEAST(now(), COALESCE(last_heartbeat_at, login_time))),
      session_duration = active_seconds
  WHERE student_id = NEW.student_id
    AND logout_time IS NULL;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.close_open_login_sessions_on_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS student_login_history_close_stale ON public.student_login_history;
CREATE TRIGGER student_login_history_close_stale
  BEFORE INSERT ON public.student_login_history
  FOR EACH ROW
  EXECUTE FUNCTION public.close_open_login_sessions_on_insert();

/**
 * Resume tracking for an authenticated student.
 * Closes sessions idle for more than 10 minutes, then reuses the open session or
 * starts a new one (counts_as_login = false) without crediting the gap.
 */
CREATE OR REPLACE FUNCTION public.start_student_session()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student UUID := auth.uid();
  v_now TIMESTAMPTZ := now();
  v_session_id UUID;
BEGIN
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.has_role(v_student, 'student'::app_role) THEN
    RAISE EXCEPTION 'Only students have tracked sessions' USING ERRCODE = '42501';
  END IF;

  UPDATE public.student_login_history
  SET logout_time = GREATEST(login_time, LEAST(v_now, COALESCE(last_heartbeat_at, login_time))),
      session_duration = active_seconds
  WHERE student_id = v_student
    AND logout_time IS NULL
    AND COALESCE(last_heartbeat_at, login_time) < v_now - INTERVAL '10 minutes';

  SELECT id INTO v_session_id
  FROM public.student_login_history
  WHERE student_id = v_student
    AND logout_time IS NULL
  ORDER BY login_time DESC
  LIMIT 1;

  IF v_session_id IS NULL THEN
    INSERT INTO public.student_login_history (
      student_id, login_time, counts_as_login, last_heartbeat_at
    ) VALUES (
      v_student, v_now, false, v_now
    )
    RETURNING id INTO v_session_id;
  ELSE
    -- Reuse the live session but do not credit the time spent away.
    UPDATE public.student_login_history
    SET last_heartbeat_at = v_now
    WHERE id = v_session_id;
  END IF;

  RETURN v_session_id;
END;
$$;

/**
 * Credit active time for one session.
 * p_mode:
 *   heartbeat — credit the time since the previous heartbeat (max 90s)
 *   resume    — do not credit anything, only restart the measurement window
 *   finalize  — credit the last window, then close the session
 */
CREATE OR REPLACE FUNCTION public.touch_student_session(
  p_session_id UUID,
  p_mode TEXT DEFAULT 'heartbeat'
)
RETURNS TABLE (
  ok BOOLEAN,
  session_id UUID,
  active_seconds INTEGER,
  closed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student UUID := auth.uid();
  v_row public.student_login_history%ROWTYPE;
  v_now TIMESTAMPTZ := now();
  v_delta INTEGER := 0;
  v_new_active INTEGER;
  v_day DATE;
  v_closed BOOLEAN := false;
BEGIN
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_mode IS NULL OR p_mode NOT IN ('heartbeat', 'resume', 'finalize') THEN
    RAISE EXCEPTION 'Invalid mode' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.student_login_history
  WHERE id = p_session_id
    AND student_id = v_student
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
  END IF;

  v_new_active := v_row.active_seconds;

  IF v_row.logout_time IS NOT NULL THEN
    RETURN QUERY SELECT true, v_row.id, v_row.active_seconds, true;
    RETURN;
  END IF;

  IF p_mode IN ('heartbeat', 'finalize') THEN
    v_delta := GREATEST(
      0,
      LEAST(
        90,
        FLOOR(EXTRACT(EPOCH FROM (v_now - COALESCE(v_row.last_heartbeat_at, v_row.login_time))))::INTEGER
      )
    );
  END IF;

  v_new_active := v_row.active_seconds + v_delta;

  UPDATE public.student_login_history
  SET active_seconds = v_new_active,
      last_heartbeat_at = v_now,
      session_duration = v_new_active,
      logout_time = CASE WHEN p_mode = 'finalize' THEN v_now ELSE logout_time END
  WHERE id = v_row.id;

  IF v_delta > 0 THEN
    v_day := (timezone('Asia/Manila', v_now))::date;

    INSERT INTO public.student_daily_time (student_id, day, active_seconds, updated_at)
    VALUES (v_student, v_day, v_delta, v_now)
    ON CONFLICT (student_id, day) DO UPDATE
      SET active_seconds = public.student_daily_time.active_seconds + EXCLUDED.active_seconds,
          updated_at = v_now;
  END IF;

  v_closed := p_mode = 'finalize';

  RETURN QUERY SELECT true, v_row.id, v_new_active, v_closed;
END;
$$;

/**
 * Today / yesterday / this ISO week / this month active seconds for one student.
 * SECURITY INVOKER so the RLS policies above decide who may read the rows.
 */
CREATE OR REPLACE FUNCTION public.get_student_time_spent(p_student_id UUID)
RETURNS TABLE (
  today_seconds INTEGER,
  yesterday_seconds INTEGER,
  week_seconds INTEGER,
  month_seconds INTEGER,
  total_seconds INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT
      (timezone('Asia/Manila', now()))::date AS today,
      date_trunc('week', timezone('Asia/Manila', now()))::date AS week_start,
      date_trunc('month', timezone('Asia/Manila', now()))::date AS month_start
  )
  SELECT
    COALESCE(SUM(t.active_seconds) FILTER (WHERE t.day = b.today), 0)::INTEGER AS today_seconds,
    COALESCE(SUM(t.active_seconds) FILTER (WHERE t.day = b.today - 1), 0)::INTEGER AS yesterday_seconds,
    COALESCE(SUM(t.active_seconds) FILTER (WHERE t.day >= b.week_start), 0)::INTEGER AS week_seconds,
    COALESCE(SUM(t.active_seconds) FILTER (WHERE t.day >= b.month_start), 0)::INTEGER AS month_seconds,
    COALESCE(SUM(t.active_seconds), 0)::INTEGER AS total_seconds
  FROM public.student_daily_time t
  CROSS JOIN bounds b
  WHERE t.student_id = p_student_id;
$$;

REVOKE ALL ON FUNCTION public.start_student_session() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_student_session() TO authenticated;

REVOKE ALL ON FUNCTION public.touch_student_session(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_student_session(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.get_student_time_spent(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_time_spent(UUID) TO authenticated;

-- ── 5. Parent check-in engagement ────────────────────────────────────────────
-- How often a linked parent reviews the student's account. This is deliberately
-- separate from the student's engagement score.
CREATE TABLE IF NOT EXISTS public.parent_student_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  page TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parent_student_views_parent_idx
  ON public.parent_student_views (parent_user_id, viewed_at DESC);

CREATE INDEX IF NOT EXISTS parent_student_views_student_idx
  ON public.parent_student_views (student_user_id, viewed_at DESC);

COMMENT ON TABLE public.parent_student_views IS
  'Parent check-ins on a linked student account (deduplicated in record_parent_student_view).';

ALTER TABLE public.parent_student_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Parents view own check-ins" ON public.parent_student_views;
CREATE POLICY "Parents view own check-ins" ON public.parent_student_views
  FOR SELECT USING (auth.uid() = parent_user_id);

DROP POLICY IF EXISTS "Instructors view linked parent check-ins" ON public.parent_student_views;
CREATE POLICY "Instructors view linked parent check-ins" ON public.parent_student_views
  FOR SELECT USING (public.instructor_can_view_student(student_user_id));

DROP POLICY IF EXISTS "Admins view parent check-ins" ON public.parent_student_views;
CREATE POLICY "Admins view parent check-ins" ON public.parent_student_views
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));

GRANT SELECT ON public.parent_student_views TO authenticated;

CREATE OR REPLACE FUNCTION public.record_parent_student_view(
  p_student_user_id UUID,
  p_page TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent UUID := auth.uid();
  v_recent TIMESTAMPTZ;
BEGIN
  IF v_parent IS NULL OR p_student_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.parent_student_links psl
    WHERE psl.parent_user_id = v_parent
      AND psl.student_user_id = p_student_user_id
      AND psl.status = 'approved'
  ) THEN
    RETURN false;
  END IF;

  SELECT MAX(viewed_at) INTO v_recent
  FROM public.parent_student_views
  WHERE parent_user_id = v_parent
    AND student_user_id = p_student_user_id;

  -- Repeated refreshes inside 30 minutes are one check-in.
  IF v_recent IS NOT NULL AND v_recent > now() - INTERVAL '30 minutes' THEN
    RETURN false;
  END IF;

  INSERT INTO public.parent_student_views (parent_user_id, student_user_id, page)
  VALUES (v_parent, p_student_user_id, NULLIF(btrim(COALESCE(p_page, '')), ''));

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_parent_student_view(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_parent_student_view(UUID, TEXT) TO authenticated;

-- ── 6. Recompute engagement with measured active time ────────────────────────
-- Same weights and window as before (40/30/20/10, 30 days); only the time input
-- changes from wall-clock/session_duration to active_seconds.
CREATE OR REPLACE FUNCTION public.recompute_student_engagement_internal(p_student_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_window_start TIMESTAMPTZ := now() - INTERVAL '30 days';
  v_weeks NUMERIC := GREATEST(1, EXTRACT(EPOCH FROM (now() - v_window_start)) / (7 * 24 * 3600));
  v_login_count INTEGER;
  v_login_count_window INTEGER;
  v_last_login TIMESTAMPTZ;
  v_total_seconds BIGINT;
  v_window_seconds BIGINT;
  v_assignments_viewed INTEGER;
  v_assignments_submitted INTEGER;
  v_ai_sessions INTEGER;
  v_feedback_count INTEGER;
  v_feedback_window INTEGER;
  v_participation INTEGER;
  v_modules INTEGER;
  v_announcements INTEGER;
  v_quizzes INTEGER;
  v_assign_window INTEGER;
  v_ai_window INTEGER;
  v_ai_fb_window INTEGER;
  v_login_score NUMERIC;
  v_time_score NUMERIC;
  v_assignment_score NUMERIC;
  v_ai_feedback_score NUMERIC;
  v_engagement_score NUMERIC;
  v_level TEXT;
  v_prev_level TEXT;
  v_prev_score NUMERIC;
  v_logins_per_week NUMERIC;
  v_hours_per_week NUMERIC;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE COALESCE(counts_as_login, true))::INTEGER,
    MAX(login_time) FILTER (WHERE COALESCE(counts_as_login, true)),
    COALESCE(SUM(active_seconds), 0)::BIGINT,
    COUNT(*) FILTER (
      WHERE COALESCE(counts_as_login, true) AND login_time >= v_window_start
    )::INTEGER,
    COALESCE(SUM(active_seconds) FILTER (WHERE login_time >= v_window_start), 0)::BIGINT
  INTO v_login_count, v_last_login, v_total_seconds, v_login_count_window, v_window_seconds
  FROM public.student_login_history
  WHERE student_id = p_student_id;

  SELECT
    COUNT(*) FILTER (WHERE activity_type = 'assignment_view')::INTEGER,
    COUNT(*) FILTER (WHERE activity_type IN ('assignment_submit', 'quiz_complete'))::INTEGER,
    COUNT(*) FILTER (WHERE activity_type IN ('ai_session', 'view_coaching'))::INTEGER,
    COUNT(*) FILTER (WHERE created_at >= v_window_start)::INTEGER,
    COUNT(*) FILTER (
      WHERE created_at >= v_window_start
        AND activity_type IN ('view_material', 'open_module', 'view_file', 'view_subject_page', 'page_visit')
    )::INTEGER,
    COUNT(*) FILTER (
      WHERE created_at >= v_window_start AND activity_type = 'read_announcement'
    )::INTEGER,
    COUNT(*) FILTER (
      WHERE created_at >= v_window_start AND activity_type = 'quiz_complete'
    )::INTEGER,
    COUNT(*) FILTER (
      WHERE created_at >= v_window_start
        AND activity_type IN ('assignment_view', 'assignment_submit', 'quiz_complete')
    )::INTEGER,
    COUNT(*) FILTER (
      WHERE created_at >= v_window_start
        AND activity_type IN ('ai_session', 'view_coaching')
    )::INTEGER
  INTO
    v_assignments_viewed,
    v_assignments_submitted,
    v_ai_sessions,
    v_participation,
    v_modules,
    v_announcements,
    v_quizzes,
    v_assign_window,
    v_ai_window
  FROM public.student_activity
  WHERE student_id = p_student_id;

  IF COALESCE(v_assignments_submitted, 0) = 0 THEN
    SELECT COUNT(*)::INTEGER INTO v_assignments_submitted
    FROM public.submissions
    WHERE student_id = p_student_id;
  END IF;

  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE created_at >= v_window_start)::INTEGER
  INTO v_feedback_count, v_feedback_window
  FROM public.student_engagement_feedback
  WHERE student_id = p_student_id;

  IF COALESCE(v_assign_window, 0) = 0 THEN
    SELECT COUNT(*)::INTEGER INTO v_assign_window
    FROM public.submissions
    WHERE student_id = p_student_id
      AND submitted_at >= v_window_start;
  END IF;

  v_ai_fb_window := COALESCE(v_ai_window, 0) + COALESCE(v_feedback_window, 0);

  v_logins_per_week := COALESCE(v_login_count_window, 0)::NUMERIC / v_weeks;
  v_login_score := LEAST(100, (v_logins_per_week / 5.0) * 100);
  v_hours_per_week := (COALESCE(v_window_seconds, 0)::NUMERIC / 3600.0) / v_weeks;
  v_time_score := LEAST(100, (v_hours_per_week / 5.0) * 100);
  v_assignment_score := LEAST(100, (COALESCE(v_assign_window, 0)::NUMERIC / 10.0) * 100);
  v_ai_feedback_score := LEAST(100, (COALESCE(v_ai_fb_window, 0)::NUMERIC / 5.0) * 100);

  v_engagement_score := ROUND(
    v_login_score * 0.40 + v_time_score * 0.30 + v_assignment_score * 0.20 + v_ai_feedback_score * 0.10, 1
  );

  IF v_engagement_score >= 80 THEN v_level := 'very_high';
  ELSIF v_engagement_score >= 60 THEN v_level := 'high';
  ELSIF v_engagement_score >= 40 THEN v_level := 'moderate';
  ELSE v_level := 'low';
  END IF;

  SELECT engagement_level, engagement_score INTO v_prev_level, v_prev_score
  FROM public.student_engagement_summary WHERE student_id = p_student_id;

  IF EXISTS (
    SELECT 1
    FROM public.student_engagement_summary s
    WHERE s.student_id = p_student_id
      AND s.engagement_level IS NOT DISTINCT FROM v_level
      AND s.engagement_score IS NOT DISTINCT FROM v_engagement_score
      AND s.total_login_count IS NOT DISTINCT FROM COALESCE(v_login_count, 0)
      AND s.last_login_at IS NOT DISTINCT FROM v_last_login
      AND s.total_time_spent_seconds IS NOT DISTINCT FROM COALESCE(v_total_seconds, 0)::INTEGER
      AND s.participation_count IS NOT DISTINCT FROM COALESCE(v_participation, 0)
      AND s.modules_viewed IS NOT DISTINCT FROM COALESCE(v_modules, 0)
      AND s.announcements_read IS NOT DISTINCT FROM COALESCE(v_announcements, 0)
      AND s.assignments_submitted IS NOT DISTINCT FROM COALESCE(v_assignments_submitted, 0)
      AND s.quiz_attempts IS NOT DISTINCT FROM COALESCE(v_quizzes, 0)
      AND s.assignments_viewed IS NOT DISTINCT FROM COALESCE(v_assignments_viewed, 0)
      AND s.ai_sessions IS NOT DISTINCT FROM COALESCE(v_ai_sessions, 0)
      AND s.feedback_count IS NOT DISTINCT FROM COALESCE(v_feedback_count, 0)
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.student_engagement_summary (
    student_id, engagement_level, engagement_score, total_login_count, last_login_at,
    total_time_spent_seconds, participation_count, modules_viewed, announcements_read,
    assignments_submitted, quiz_attempts, assignments_viewed, ai_sessions, feedback_count,
    previous_engagement_level, previous_engagement_score, updated_at
  ) VALUES (
    p_student_id, v_level, v_engagement_score, COALESCE(v_login_count, 0), v_last_login,
    COALESCE(v_total_seconds, 0)::INTEGER, COALESCE(v_participation, 0), COALESCE(v_modules, 0),
    COALESCE(v_announcements, 0), COALESCE(v_assignments_submitted, 0), COALESCE(v_quizzes, 0),
    COALESCE(v_assignments_viewed, 0), COALESCE(v_ai_sessions, 0), COALESCE(v_feedback_count, 0),
    CASE WHEN v_prev_level IS NOT NULL AND v_prev_level <> v_level THEN v_prev_level ELSE NULL END,
    CASE WHEN v_prev_score IS NOT NULL AND v_prev_score IS DISTINCT FROM v_engagement_score THEN v_prev_score ELSE NULL END,
    now()
  )
  ON CONFLICT (student_id) DO UPDATE SET
    engagement_level = EXCLUDED.engagement_level,
    engagement_score = EXCLUDED.engagement_score,
    total_login_count = EXCLUDED.total_login_count,
    last_login_at = EXCLUDED.last_login_at,
    total_time_spent_seconds = EXCLUDED.total_time_spent_seconds,
    participation_count = EXCLUDED.participation_count,
    modules_viewed = EXCLUDED.modules_viewed,
    announcements_read = EXCLUDED.announcements_read,
    assignments_submitted = EXCLUDED.assignments_submitted,
    quiz_attempts = EXCLUDED.quiz_attempts,
    assignments_viewed = EXCLUDED.assignments_viewed,
    ai_sessions = EXCLUDED.ai_sessions,
    feedback_count = EXCLUDED.feedback_count,
    previous_engagement_level = CASE
      WHEN student_engagement_summary.engagement_level <> EXCLUDED.engagement_level
      THEN student_engagement_summary.engagement_level
      ELSE student_engagement_summary.previous_engagement_level
    END,
    previous_engagement_score = CASE
      WHEN student_engagement_summary.engagement_score IS DISTINCT FROM EXCLUDED.engagement_score
      THEN student_engagement_summary.engagement_score
      ELSE student_engagement_summary.previous_engagement_score
    END,
    updated_at = now();

  PERFORM public.evaluate_engagement_alerts(p_student_id);
END;
$function$;

-- Summaries refresh on the next engagement event (login, activity, submission,
-- AI session, feedback). They are intentionally not recomputed for every
-- student here: a mass recompute would fire the alert evaluator for the whole
-- campus at once and could send "score dropped" notifications caused only by
-- the corrected time formula.

