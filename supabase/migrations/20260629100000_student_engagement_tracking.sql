-- Student engagement tracking: login history, activity events, and computed summary.

CREATE TABLE IF NOT EXISTS public.student_login_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  login_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  logout_time TIMESTAMPTZ,
  session_duration INTEGER,
  device TEXT,
  browser TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.student_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN (
    'view_material', 'open_module', 'read_announcement', 'view_file',
    'view_subject_page', 'view_coaching', 'view_grades', 'view_attendance',
    'quiz_complete', 'assignment_submit'
  )),
  activity_description TEXT,
  login_timestamp TIMESTAMPTZ,
  source_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.student_engagement_summary (
  student_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  engagement_level TEXT NOT NULL DEFAULT 'moderate' CHECK (engagement_level IN (
    'very_high', 'high', 'moderate', 'low'
  )),
  engagement_score NUMERIC NOT NULL DEFAULT 0,
  total_login_count INTEGER NOT NULL DEFAULT 0,
  last_login_at TIMESTAMPTZ,
  participation_count INTEGER NOT NULL DEFAULT 0,
  modules_viewed INTEGER NOT NULL DEFAULT 0,
  announcements_read INTEGER NOT NULL DEFAULT 0,
  assignments_submitted INTEGER NOT NULL DEFAULT 0,
  quiz_attempts INTEGER NOT NULL DEFAULT 0,
  previous_engagement_level TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Dedup: one page-view activity per student/type/subject/day
CREATE UNIQUE INDEX IF NOT EXISTS student_activity_daily_dedup_idx
  ON public.student_activity (
    student_id,
    activity_type,
    subject_id,
    (date_trunc('day', created_at AT TIME ZONE 'UTC'))
  )
  WHERE subject_id IS NOT NULL;

-- Dedup: one activity per source (e.g. submission id)
CREATE UNIQUE INDEX IF NOT EXISTS student_activity_source_dedup_idx
  ON public.student_activity (student_id, activity_type, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS student_login_history_student_id_idx
  ON public.student_login_history (student_id, login_time DESC);

CREATE INDEX IF NOT EXISTS student_activity_student_id_idx
  ON public.student_activity (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS student_activity_subject_id_idx
  ON public.student_activity (subject_id, created_at DESC);

-- Helper: instructor can view student engagement data for their subjects
CREATE OR REPLACE FUNCTION public.instructor_can_view_student(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.enrollments e
    JOIN public.subjects s ON s.id = e.subject_id
    WHERE e.student_id = p_student_id
      AND e.status = 'active'
      AND s.instructor_id = auth.uid()
  );
$$;

-- Recompute engagement summary for a student (30-day rolling window)
CREATE OR REPLACE FUNCTION public.recompute_student_engagement(p_student_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMPTZ := now() - INTERVAL '30 days';
  v_login_count INTEGER;
  v_last_login TIMESTAMPTZ;
  v_participation INTEGER;
  v_modules INTEGER;
  v_announcements INTEGER;
  v_assignments INTEGER;
  v_quizzes INTEGER;
  v_login_score NUMERIC;
  v_participation_score NUMERIC;
  v_material_score NUMERIC;
  v_timely_score NUMERIC;
  v_engagement_score NUMERIC;
  v_level TEXT;
  v_prev_level TEXT;
  v_weeks NUMERIC := GREATEST(1, EXTRACT(EPOCH FROM (now() - v_window_start)) / (7 * 24 * 3600));
  v_logins_per_week NUMERIC;
  v_total_submissions INTEGER;
  v_timely_submissions INTEGER;
BEGIN
  SELECT COUNT(*), MAX(login_time)
  INTO v_login_count, v_last_login
  FROM public.student_login_history
  WHERE student_id = p_student_id
    AND login_time >= v_window_start;

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
    AND activity_type IN ('view_material', 'open_module', 'view_file', 'view_subject_page');

  SELECT COUNT(*)
  INTO v_announcements
  FROM public.student_activity
  WHERE student_id = p_student_id
    AND created_at >= v_window_start
    AND activity_type = 'read_announcement';

  SELECT COUNT(*)
  INTO v_assignments
  FROM public.student_activity
  WHERE student_id = p_student_id
    AND created_at >= v_window_start
    AND activity_type = 'assignment_submit';

  SELECT COUNT(*)
  INTO v_quizzes
  FROM public.student_activity
  WHERE student_id = p_student_id
    AND created_at >= v_window_start
    AND activity_type = 'quiz_complete';

  -- Login frequency: target 5 logins/week = 100%
  v_logins_per_week := COALESCE(v_login_count, 0)::NUMERIC / v_weeks;
  v_login_score := LEAST(100, (v_logins_per_week / 5.0) * 100);

  -- Participation: target 20 events in 30 days = 100%
  v_participation_score := LEAST(100, (COALESCE(v_participation, 0)::NUMERIC / 20.0) * 100);

  -- Material views: target 15 views = 100%
  v_material_score := LEAST(100, (COALESCE(v_modules, 0)::NUMERIC / 15.0) * 100);

  -- Timely submissions from submissions table
  SELECT COUNT(*), COUNT(*) FILTER (
    WHERE a.due_date IS NULL OR sub.submitted_at <= a.due_date
  )
  INTO v_total_submissions, v_timely_submissions
  FROM public.submissions sub
  JOIN public.activities a ON a.id = sub.activity_id
  WHERE sub.student_id = p_student_id
    AND sub.submitted_at >= v_window_start;

  IF COALESCE(v_total_submissions, 0) > 0 THEN
    v_timely_score := (v_timely_submissions::NUMERIC / v_total_submissions::NUMERIC) * 100;
  ELSE
    v_timely_score := 50;
  END IF;

  v_engagement_score := ROUND(
    v_login_score * 0.25 +
    v_participation_score * 0.35 +
    v_material_score * 0.25 +
    v_timely_score * 0.15,
    1
  );

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
    participation_count,
    modules_viewed,
    announcements_read,
    assignments_submitted,
    quiz_attempts,
    previous_engagement_level,
    updated_at
  ) VALUES (
    p_student_id,
    v_level,
    v_engagement_score,
    COALESCE(v_login_count, 0),
    v_last_login,
    COALESCE(v_participation, 0),
    COALESCE(v_modules, 0),
    COALESCE(v_announcements, 0),
    COALESCE(v_assignments, 0),
    COALESCE(v_quizzes, 0),
    CASE WHEN v_prev_level IS NOT NULL AND v_prev_level <> v_level THEN v_prev_level ELSE NULL END,
    now()
  )
  ON CONFLICT (student_id) DO UPDATE SET
    engagement_level = EXCLUDED.engagement_level,
    engagement_score = EXCLUDED.engagement_score,
    total_login_count = EXCLUDED.total_login_count,
    last_login_at = EXCLUDED.last_login_at,
    participation_count = EXCLUDED.participation_count,
    modules_viewed = EXCLUDED.modules_viewed,
    announcements_read = EXCLUDED.announcements_read,
    assignments_submitted = EXCLUDED.assignments_submitted,
    quiz_attempts = EXCLUDED.quiz_attempts,
    previous_engagement_level = CASE
      WHEN student_engagement_summary.engagement_level <> EXCLUDED.engagement_level
      THEN student_engagement_summary.engagement_level
      ELSE student_engagement_summary.previous_engagement_level
    END,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_recompute_engagement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recompute_student_engagement(
    COALESCE(NEW.student_id, OLD.student_id)
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

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

-- RLS
ALTER TABLE public.student_login_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_engagement_summary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students manage own login history" ON public.student_login_history;
CREATE POLICY "Students manage own login history" ON public.student_login_history
  FOR ALL USING (auth.uid() = student_id)
  WITH CHECK (auth.uid() = student_id);

DROP POLICY IF EXISTS "Instructors view student login history" ON public.student_login_history;
CREATE POLICY "Instructors view student login history" ON public.student_login_history
  FOR SELECT USING (public.instructor_can_view_student(student_id));

DROP POLICY IF EXISTS "Admins view all login history" ON public.student_login_history;
CREATE POLICY "Admins view all login history" ON public.student_login_history
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Students manage own activity" ON public.student_activity;
CREATE POLICY "Students manage own activity" ON public.student_activity
  FOR ALL USING (auth.uid() = student_id)
  WITH CHECK (auth.uid() = student_id);

DROP POLICY IF EXISTS "Instructors view student activity" ON public.student_activity;
CREATE POLICY "Instructors view student activity" ON public.student_activity
  FOR SELECT USING (public.instructor_can_view_student(student_id));

DROP POLICY IF EXISTS "Admins view all student activity" ON public.student_activity;
CREATE POLICY "Admins view all student activity" ON public.student_activity
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Students view own engagement summary" ON public.student_engagement_summary;
CREATE POLICY "Students view own engagement summary" ON public.student_engagement_summary
  FOR SELECT USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "Instructors view student engagement summary" ON public.student_engagement_summary;
CREATE POLICY "Instructors view student engagement summary" ON public.student_engagement_summary
  FOR SELECT USING (public.instructor_can_view_student(student_id));

DROP POLICY IF EXISTS "Admins view all engagement summaries" ON public.student_engagement_summary;
CREATE POLICY "Admins view all engagement summaries" ON public.student_engagement_summary
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Service role / triggers write summaries via SECURITY DEFINER function

ALTER PUBLICATION supabase_realtime ADD TABLE public.student_engagement_summary;
