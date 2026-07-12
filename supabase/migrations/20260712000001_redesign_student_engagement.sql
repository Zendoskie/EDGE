-- Redesign student engagement: all-time logins, total time spent, simplified feedback.

ALTER TABLE public.student_engagement_summary
  ADD COLUMN IF NOT EXISTS total_time_spent_seconds INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.student_login_history
  ADD COLUMN IF NOT EXISTS counts_as_login BOOLEAN NOT NULL DEFAULT true;

-- Simplified recompute: all-time logins, total session time, last login.
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
    AND counts_as_login = true;

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

-- General student engagement feedback (separate from risk-triggered student_feedback).
CREATE TABLE IF NOT EXISTS public.student_engagement_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject TEXT,
  message TEXT NOT NULL CHECK (char_length(trim(message)) > 0),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'reviewed', 'resolved')),
  counselor_remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_engagement_feedback_student_id_idx
  ON public.student_engagement_feedback (student_id, created_at DESC);

ALTER TABLE public.student_engagement_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students manage own engagement feedback" ON public.student_engagement_feedback;
CREATE POLICY "Students manage own engagement feedback"
  ON public.student_engagement_feedback
  FOR ALL
  USING (auth.uid() = student_id)
  WITH CHECK (auth.uid() = student_id);

DROP POLICY IF EXISTS "Instructors view student engagement feedback" ON public.student_engagement_feedback;
CREATE POLICY "Instructors view student engagement feedback"
  ON public.student_engagement_feedback
  FOR SELECT
  USING (public.instructor_can_view_student(student_id));

DROP POLICY IF EXISTS "Guidance counselors view engagement feedback" ON public.student_engagement_feedback;
CREATE POLICY "Guidance counselors view engagement feedback"
  ON public.student_engagement_feedback
  FOR SELECT
  USING (public.has_role(auth.uid(), 'guidance_counselor'::app_role));

DROP POLICY IF EXISTS "Admins view all engagement feedback" ON public.student_engagement_feedback;
CREATE POLICY "Admins view all engagement feedback"
  ON public.student_engagement_feedback
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));

ALTER PUBLICATION supabase_realtime ADD TABLE public.student_engagement_feedback;
