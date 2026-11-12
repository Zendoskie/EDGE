-- Use statement time (clock_timestamp) for session beats.
--
-- now() returns the transaction start, so two beats inside one transaction would
-- measure zero seconds. Each HTTP heartbeat is normally its own transaction, but
-- the measurement should not depend on that. These replacements are otherwise
-- identical to the versions in 20261110130000_engagement_active_time_and_periods.sql.

CREATE OR REPLACE FUNCTION public.start_student_session()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student UUID := auth.uid();
  v_now TIMESTAMPTZ := clock_timestamp();
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
  v_now TIMESTAMPTZ := clock_timestamp();
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
