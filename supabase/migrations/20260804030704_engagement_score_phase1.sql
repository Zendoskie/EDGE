-- Phase 1: Engagement score foundation
-- Reuses existing student_login_history / student_activity / student_engagement_summary
-- (Phase 1 names student_login_logs / student_activity_logs are exposed as views).

-- ── 1. Compatibility views (Phase 1 table names) ─────────────────────────────
CREATE OR REPLACE VIEW public.student_login_logs
  WITH (security_invoker = true)
AS
SELECT *
FROM public.student_login_history;

CREATE OR REPLACE VIEW public.student_activity_logs
  WITH (security_invoker = true)
AS
SELECT *
FROM public.student_activity;

COMMENT ON VIEW public.student_login_logs IS
  'Phase 1 alias for student_login_history (login/logout/session duration).';
COMMENT ON VIEW public.student_activity_logs IS
  'Phase 1 alias for student_activity (page visits, assignments, AI, feedback).';
COMMENT ON TABLE public.student_login_history IS
  'Canonical login/session log table. Also exposed as student_login_logs.';
COMMENT ON TABLE public.student_activity IS
  'Canonical student activity log table. Also exposed as student_activity_logs.';

GRANT SELECT ON public.student_login_logs TO authenticated;
GRANT SELECT ON public.student_activity_logs TO authenticated;

-- ── 2. Extend engagement summary metrics ─────────────────────────────────────
ALTER TABLE public.student_engagement_summary
  ADD COLUMN IF NOT EXISTS assignments_viewed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_sessions INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS feedback_count INTEGER NOT NULL DEFAULT 0;

-- ── 3. Expand activity_type check for Phase 1 events ─────────────────────────
ALTER TABLE public.student_activity
  DROP CONSTRAINT IF EXISTS student_activity_activity_type_check;

ALTER TABLE public.student_activity
  ADD CONSTRAINT student_activity_activity_type_check
  CHECK (activity_type IN (
    'view_material',
    'open_module',
    'read_announcement',
    'view_file',
    'view_subject_page',
    'view_coaching',
    'view_grades',
    'view_attendance',
    'quiz_complete',
    'assignment_submit',
    'assignment_view',
    'ai_session',
    'feedback_submit',
    'page_visit'
  ));

-- ── 4. Internal recompute (no auth gate — used by triggers / SECURITY DEFINER) ─
CREATE OR REPLACE FUNCTION public.recompute_student_engagement_internal(p_student_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  v_participation INTEGER;
  v_modules INTEGER;
  v_announcements INTEGER;
  v_quizzes INTEGER;

  v_assign_window INTEGER;
  v_ai_fb_window INTEGER;

  v_login_score NUMERIC;
  v_time_score NUMERIC;
  v_assignment_score NUMERIC;
  v_ai_feedback_score NUMERIC;
  v_engagement_score NUMERIC;
  v_level TEXT;
  v_prev_level TEXT;

  v_logins_per_week NUMERIC;
  v_hours_per_week NUMERIC;
BEGIN
  -- All-time login totals (counts_as_login only)
  SELECT COUNT(*), MAX(login_time)
  INTO v_login_count, v_last_login
  FROM public.student_login_history
  WHERE student_id = p_student_id
    AND COALESCE(counts_as_login, true) = true;

  -- All-time time spent
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

  -- Windowed logins for frequency score
  SELECT COUNT(*)
  INTO v_login_count_window
  FROM public.student_login_history
  WHERE student_id = p_student_id
    AND COALESCE(counts_as_login, true) = true
    AND login_time >= v_window_start;

  -- Windowed time for time-spent score
  SELECT COALESCE(SUM(
    CASE
      WHEN session_duration IS NOT NULL THEN session_duration
      WHEN logout_time IS NOT NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (logout_time - login_time))::INTEGER)
      ELSE GREATEST(0, EXTRACT(EPOCH FROM (now() - login_time))::INTEGER)
    END
  ), 0)
  INTO v_window_seconds
  FROM public.student_login_history
  WHERE student_id = p_student_id
    AND login_time >= v_window_start;

  -- Activity counters (all-time for summary columns)
  SELECT COUNT(*)
  INTO v_assignments_viewed
  FROM public.student_activity
  WHERE student_id = p_student_id
    AND activity_type = 'assignment_view';

  SELECT COUNT(*)
  INTO v_assignments_submitted
  FROM public.student_activity
  WHERE student_id = p_student_id
    AND activity_type IN ('assignment_submit', 'quiz_complete');

  -- Prefer submissions table when activity logs are sparse
  IF COALESCE(v_assignments_submitted, 0) = 0 THEN
    SELECT COUNT(*)
    INTO v_assignments_submitted
    FROM public.submissions
    WHERE student_id = p_student_id;
  END IF;

  SELECT COUNT(*)
  INTO v_ai_sessions
  FROM public.student_activity
  WHERE student_id = p_student_id
    AND activity_type IN ('ai_session', 'view_coaching');

  SELECT COUNT(*)
  INTO v_feedback_count
  FROM public.student_engagement_feedback
  WHERE student_id = p_student_id;

  SELECT COUNT(*)
  INTO v_participation
  FROM public.student_activity
  WHERE student_id = p_student_id
    AND created_at >= v_window_start;

  SELECT COUNT(*)
  INTO v_modules
  FROM public.student_activity
  WHERE student_id = p_student_id
    AND created_at >= v_window_start
    AND activity_type IN ('view_material', 'open_module', 'view_file', 'view_subject_page', 'page_visit');

  SELECT COUNT(*)
  INTO v_announcements
  FROM public.student_activity
  WHERE student_id = p_student_id
    AND created_at >= v_window_start
    AND activity_type = 'read_announcement';

  SELECT COUNT(*)
  INTO v_quizzes
  FROM public.student_activity
  WHERE student_id = p_student_id
    AND created_at >= v_window_start
    AND activity_type = 'quiz_complete';

  -- Windowed assignment + AI/feedback for scoring
  SELECT COUNT(*)
  INTO v_assign_window
  FROM public.student_activity
  WHERE student_id = p_student_id
    AND created_at >= v_window_start
    AND activity_type IN ('assignment_view', 'assignment_submit', 'quiz_complete');

  IF COALESCE(v_assign_window, 0) = 0 THEN
    SELECT COUNT(*)
    INTO v_assign_window
    FROM public.submissions
    WHERE student_id = p_student_id
      AND submitted_at >= v_window_start;
  END IF;

  SELECT
    (SELECT COUNT(*)
     FROM public.student_activity
     WHERE student_id = p_student_id
       AND created_at >= v_window_start
       AND activity_type IN ('ai_session', 'view_coaching'))
    +
    (SELECT COUNT(*)
     FROM public.student_engagement_feedback
     WHERE student_id = p_student_id
       AND created_at >= v_window_start)
  INTO v_ai_fb_window;

  -- Login Frequency 40% — target 5 logins/week
  v_logins_per_week := COALESCE(v_login_count_window, 0)::NUMERIC / v_weeks;
  v_login_score := LEAST(100, (v_logins_per_week / 5.0) * 100);

  -- Time Spent 30% — target 5 hours/week
  v_hours_per_week := (COALESCE(v_window_seconds, 0)::NUMERIC / 3600.0) / v_weeks;
  v_time_score := LEAST(100, (v_hours_per_week / 5.0) * 100);

  -- Assignment Activity 20% — target 10 events in 30 days
  v_assignment_score := LEAST(100, (COALESCE(v_assign_window, 0)::NUMERIC / 10.0) * 100);

  -- AI/Feedback Participation 10% — target 5 events in 30 days
  v_ai_feedback_score := LEAST(100, (COALESCE(v_ai_fb_window, 0)::NUMERIC / 5.0) * 100);

  v_engagement_score := ROUND(
    v_login_score * 0.40 +
    v_time_score * 0.30 +
    v_assignment_score * 0.20 +
    v_ai_feedback_score * 0.10,
    1
  );

  -- Classification: 80+ Highly Active, 60–79 Active, 40–59 Low Engagement, <40 Inactive
  -- Stored as existing canonical keys for UI compatibility.
  IF v_engagement_score >= 80 THEN
    v_level := 'very_high';
  ELSIF v_engagement_score >= 60 THEN
    v_level := 'high';
  ELSIF v_engagement_score >= 40 THEN
    v_level := 'moderate';
  ELSE
    v_level := 'low';
  END IF;

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
    assignments_viewed,
    ai_sessions,
    feedback_count,
    previous_engagement_level,
    updated_at
  ) VALUES (
    p_student_id,
    v_level,
    v_engagement_score,
    COALESCE(v_login_count, 0),
    v_last_login,
    COALESCE(v_total_seconds, 0)::INTEGER,
    COALESCE(v_participation, 0),
    COALESCE(v_modules, 0),
    COALESCE(v_announcements, 0),
    COALESCE(v_assignments_submitted, 0),
    COALESCE(v_quizzes, 0),
    COALESCE(v_assignments_viewed, 0),
    COALESCE(v_ai_sessions, 0),
    COALESCE(v_feedback_count, 0),
    CASE
      WHEN v_prev_level IS NOT NULL AND v_prev_level <> v_level THEN v_prev_level
      ELSE NULL
    END,
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
    updated_at = now();
END;
$$;

-- ── 5. Public recompute with authorization gate ──────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_student_engagement(p_student_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND auth.uid() <> p_student_id
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role)
     AND NOT public.instructor_can_view_student(p_student_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM public.recompute_student_engagement_internal(p_student_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_student_engagement_internal(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_student_engagement(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_student_engagement(UUID) TO service_role;

-- Triggers call the internal function so instructor/service writes still recompute.
CREATE OR REPLACE FUNCTION public.trigger_recompute_engagement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recompute_student_engagement_internal(
    COALESCE(NEW.student_id, OLD.student_id)
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── 6. Auto-record assignment submissions from submissions table ─────────────
CREATE OR REPLACE FUNCTION public.trigger_submission_engagement_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subject_id UUID;
  v_activity_type TEXT;
  v_title TEXT;
BEGIN
  SELECT a.subject_id,
         CASE WHEN a.type = 'quiz' THEN 'quiz_complete' ELSE 'assignment_submit' END,
         a.title
  INTO v_subject_id, v_activity_type, v_title
  FROM public.activities a
  WHERE a.id = NEW.activity_id;

  INSERT INTO public.student_activity (
    student_id,
    subject_id,
    activity_type,
    activity_description,
    source_id
  ) VALUES (
    NEW.student_id,
    v_subject_id,
    v_activity_type,
    COALESCE(v_title, 'Assignment submission'),
    NEW.id
  )
  ON CONFLICT DO NOTHING;

  PERFORM public.recompute_student_engagement_internal(NEW.student_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS submissions_engagement_activity ON public.submissions;
CREATE TRIGGER submissions_engagement_activity
  AFTER INSERT ON public.submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_submission_engagement_activity();

-- ── 7. Recompute when engagement feedback is submitted ───────────────────────
CREATE OR REPLACE FUNCTION public.trigger_feedback_engagement_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.student_activity (
    student_id,
    activity_type,
    activity_description,
    source_id
  ) VALUES (
    NEW.student_id,
    'feedback_submit',
    COALESCE(NULLIF(trim(NEW.subject), ''), 'Engagement feedback'),
    NEW.id
  )
  ON CONFLICT DO NOTHING;

  PERFORM public.recompute_student_engagement_internal(NEW.student_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS engagement_feedback_recompute ON public.student_engagement_feedback;
CREATE TRIGGER engagement_feedback_recompute
  AFTER INSERT ON public.student_engagement_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_feedback_engagement_activity();

-- Ensure login/activity recompute triggers use updated function
DROP TRIGGER IF EXISTS student_activity_recompute_engagement ON public.student_activity;
CREATE TRIGGER student_activity_recompute_engagement
  AFTER INSERT OR UPDATE ON public.student_activity
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_recompute_engagement();

DROP TRIGGER IF EXISTS student_login_history_recompute_engagement ON public.student_login_history;
CREATE TRIGGER student_login_history_recompute_engagement
  AFTER INSERT OR UPDATE ON public.student_login_history
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_recompute_engagement();

-- ── 8. RLS: ensure core tables remain protected; views use security_invoker ──
ALTER TABLE public.student_login_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_engagement_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_engagement_feedback ENABLE ROW LEVEL SECURITY;

-- Allow students to insert non-counted resume sessions (session duration tracking)
DROP POLICY IF EXISTS "Students insert own login history" ON public.student_login_history;
CREATE POLICY "Students insert own login history" ON public.student_login_history
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = student_id);

-- Guidance counselors can read engagement summaries for referred students' context
DROP POLICY IF EXISTS "Guidance counselors view engagement summaries" ON public.student_engagement_summary;
CREATE POLICY "Guidance counselors view engagement summaries"
  ON public.student_engagement_summary
  FOR SELECT
  USING (public.has_role(auth.uid(), 'guidance_counselor'::app_role));

-- Backfill scores for existing students
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT student_id FROM public.student_login_history
    UNION
    SELECT DISTINCT student_id FROM public.student_activity
    UNION
    SELECT student_id FROM public.student_engagement_summary
  LOOP
    PERFORM public.recompute_student_engagement_internal(r.student_id);
  END LOOP;
END;
$$;
