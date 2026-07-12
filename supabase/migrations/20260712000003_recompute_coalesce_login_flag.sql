-- Treat legacy rows without counts_as_login as real logins.

CREATE OR REPLACE FUNCTION public.recompute_student_engagement(p_student_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_login_count INTEGER;
  v_last_login TIMESTAMPTZ;
  v_total_seconds BIGINT;
  v_prev_level TEXT;
BEGIN
  SELECT COUNT(*), MAX(login_time)
  INTO v_login_count, v_last_login
  FROM public.student_login_history
  WHERE student_id = p_student_id
    AND COALESCE(counts_as_login, true) = true;

  SELECT COALESCE(SUM(
    CASE
      WHEN session_duration IS NOT NULL THEN session_duration
      WHEN logout_time IS NOT NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (logout_time - login_time))::INTEGER)
      ELSE GREATEST(0, EXTRACT(EPOCH FROM (now() - login_time))::INTEGER)
    END
  ), 0)
  INTO v_total_seconds
  FROM public.student_login_history
  WHERE student_id = p_student_id;

  SELECT engagement_level INTO v_prev_level
  FROM public.student_engagement_summary
  WHERE student_id = p_student_id;

  INSERT INTO public.student_engagement_summary (
    student_id,
    engagement_level,
    engagement_score,
    total_login_count,
    last_login_at,
    total_time_spent_seconds,
    participation_count,
    modules_viewed,
    announcements_read,
    assignments_submitted,
    quiz_attempts,
    previous_engagement_level,
    updated_at
  ) VALUES (
    p_student_id,
    COALESCE(v_prev_level, 'moderate'),
    0,
    COALESCE(v_login_count, 0),
    v_last_login,
    COALESCE(v_total_seconds, 0)::INTEGER,
    0,
    0,
    0,
    0,
    0,
    NULL,
    now()
  )
  ON CONFLICT (student_id) DO UPDATE SET
    total_login_count = EXCLUDED.total_login_count,
    last_login_at = EXCLUDED.last_login_at,
    total_time_spent_seconds = EXCLUDED.total_time_spent_seconds,
    updated_at = now();
END;
$$;
