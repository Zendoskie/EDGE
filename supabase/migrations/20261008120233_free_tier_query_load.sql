-- Free-tier load reduction.
-- Engagement formula is unchanged. Writes are skipped when every stored summary
-- value already matches, so a repeat recompute does not emit a Realtime update.
-- Indexes match the student/instructor filters already used by the dashboards.

CREATE INDEX IF NOT EXISTS predictions_student_created_idx
  ON public.predictions (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS predictions_subject_created_idx
  ON public.predictions (subject_id, created_at DESC);

CREATE INDEX IF NOT EXISTS submissions_student_id_idx
  ON public.submissions (student_id);

CREATE INDEX IF NOT EXISTS attendance_student_subject_idx
  ON public.attendance (student_id, subject_id);

CREATE INDEX IF NOT EXISTS attendance_subject_date_idx
  ON public.attendance (subject_id, date DESC);

-- One latest prediction per subject. RLS still applies (SECURITY INVOKER).
CREATE OR REPLACE FUNCTION public.latest_student_predictions(p_student_id uuid)
RETURNS TABLE (
  id uuid,
  subject_id uuid,
  risk_level text,
  risk_score numeric,
  recommendation text,
  created_at timestamptz,
  confidence numeric,
  attendance_rate numeric,
  activity_average numeric,
  activity_completion_rate numeric,
  quiz_average numeric,
  laboratory_exam_average numeric,
  comprehension_rating numeric,
  subject_code text,
  subject_name text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT ON (p.subject_id)
    p.id,
    p.subject_id,
    p.risk_level,
    p.risk_score,
    p.recommendation,
    p.created_at,
    p.confidence,
    p.attendance_rate,
    p.activity_average,
    p.activity_completion_rate,
    p.quiz_average,
    p.laboratory_exam_average,
    p.comprehension_rating,
    s.code,
    s.name
  FROM public.predictions p
  LEFT JOIN public.subjects s ON s.id = p.subject_id
  WHERE p.student_id = p_student_id
    AND p.subject_id IS NOT NULL
  ORDER BY p.subject_id, p.created_at DESC NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.latest_student_predictions(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.latest_student_predictions(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.latest_student_predictions(uuid) TO authenticated;

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
    COALESCE(SUM(
      CASE
        WHEN session_duration IS NOT NULL THEN session_duration
        WHEN logout_time IS NOT NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (logout_time - login_time))::INTEGER)
        ELSE GREATEST(0, EXTRACT(EPOCH FROM (now() - login_time))::INTEGER)
      END
    ), 0)::BIGINT,
    COUNT(*) FILTER (
      WHERE COALESCE(counts_as_login, true) AND login_time >= v_window_start
    )::INTEGER,
    COALESCE(SUM(
      CASE
        WHEN session_duration IS NOT NULL THEN session_duration
        WHEN logout_time IS NOT NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (logout_time - login_time))::INTEGER)
        ELSE GREATEST(0, EXTRACT(EPOCH FROM (now() - login_time))::INTEGER)
      END
    ) FILTER (WHERE login_time >= v_window_start), 0)::BIGINT
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
