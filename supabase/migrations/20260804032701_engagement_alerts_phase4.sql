-- Phase 4: Engagement alerts + instructor interventions

-- ── 1. Track previous score for % drop detection ─────────────────────────────
ALTER TABLE public.student_engagement_summary
  ADD COLUMN IF NOT EXISTS previous_engagement_score NUMERIC;

-- ── 2. engagement_alerts ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.engagement_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN (
    'no_login_3_days',
    'no_login_7_days',
    'score_drop_20',
    'active_to_low',
    'low_to_inactive'
  )),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  from_level TEXT,
  to_level TEXT,
  from_score NUMERIC,
  to_score NUMERIC,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  dedupe_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  CONSTRAINT engagement_alerts_student_type_dedupe_key UNIQUE (student_id, alert_type, dedupe_key)
);

CREATE INDEX IF NOT EXISTS engagement_alerts_student_created_idx
  ON public.engagement_alerts (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS engagement_alerts_status_idx
  ON public.engagement_alerts (status, created_at DESC);

-- Ensure unique constraint exists when table was created by an earlier draft.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'engagement_alerts_student_type_dedupe_key'
  ) THEN
    ALTER TABLE public.engagement_alerts
      ADD CONSTRAINT engagement_alerts_student_type_dedupe_key
      UNIQUE (student_id, alert_type, dedupe_key);
  END IF;
END;
$$;

-- ── 3. engagement_interventions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.engagement_interventions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID REFERENCES public.engagement_alerts(id) ON DELETE SET NULL,
  student_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instructor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN (
    'send_reminder',
    'send_email_reminder',
    'schedule_consultation',
    'add_note',
    'mark_contacted'
  )),
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS engagement_interventions_student_idx
  ON public.engagement_interventions (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS engagement_interventions_instructor_idx
  ON public.engagement_interventions (instructor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS engagement_interventions_alert_idx
  ON public.engagement_interventions (alert_id, created_at DESC);

-- ── 4. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.engagement_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_interventions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students view own engagement alerts" ON public.engagement_alerts;
CREATE POLICY "Students view own engagement alerts"
  ON public.engagement_alerts FOR SELECT
  USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "Instructors view student engagement alerts" ON public.engagement_alerts;
CREATE POLICY "Instructors view student engagement alerts"
  ON public.engagement_alerts FOR SELECT
  USING (public.instructor_can_view_student(student_id));

DROP POLICY IF EXISTS "Instructors update engagement alerts" ON public.engagement_alerts;
CREATE POLICY "Instructors update engagement alerts"
  ON public.engagement_alerts FOR UPDATE
  USING (public.instructor_can_view_student(student_id))
  WITH CHECK (public.instructor_can_view_student(student_id));

DROP POLICY IF EXISTS "Admins view all engagement alerts" ON public.engagement_alerts;
CREATE POLICY "Admins view all engagement alerts"
  ON public.engagement_alerts FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Students view own engagement interventions" ON public.engagement_interventions;
CREATE POLICY "Students view own engagement interventions"
  ON public.engagement_interventions FOR SELECT
  USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "Instructors manage engagement interventions" ON public.engagement_interventions;
CREATE POLICY "Instructors manage engagement interventions"
  ON public.engagement_interventions FOR ALL
  USING (
    public.instructor_can_view_student(student_id)
    OR auth.uid() = instructor_id
  )
  WITH CHECK (
    auth.uid() = instructor_id
    AND public.instructor_can_view_student(student_id)
  );

DROP POLICY IF EXISTS "Admins view engagement interventions" ON public.engagement_interventions;
CREATE POLICY "Admins view engagement interventions"
  ON public.engagement_interventions FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ── 5. Notify helpers (reuse user_inbox_notifications; do not replace existing system)
CREATE OR REPLACE FUNCTION public.notify_engagement_alert_recipients(
  p_student_id UUID,
  p_title TEXT,
  p_student_body TEXT,
  p_instructor_body TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_instructor_id UUID;
BEGIN
  INSERT INTO public.user_inbox_notifications (user_id, title, body)
  VALUES (p_student_id, p_title, p_student_body);

  FOR v_instructor_id IN
    SELECT DISTINCT s.instructor_id
    FROM public.enrollments e
    JOIN public.subjects s ON s.id = e.subject_id
    WHERE e.student_id = p_student_id
      AND e.status = 'active'
      AND s.instructor_id IS NOT NULL
  LOOP
    INSERT INTO public.user_inbox_notifications (user_id, title, body)
    VALUES (v_instructor_id, p_title, p_instructor_body);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_engagement_alert(
  p_student_id UUID,
  p_alert_type TEXT,
  p_title TEXT,
  p_message TEXT,
  p_dedupe_key TEXT,
  p_from_level TEXT DEFAULT NULL,
  p_to_level TEXT DEFAULT NULL,
  p_from_score NUMERIC DEFAULT NULL,
  p_to_score NUMERIC DEFAULT NULL,
  p_student_body TEXT DEFAULT NULL,
  p_instructor_body TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.engagement_alerts (
    student_id,
    alert_type,
    title,
    message,
    from_level,
    to_level,
    from_score,
    to_score,
    dedupe_key
  ) VALUES (
    p_student_id,
    p_alert_type,
    p_title,
    p_message,
    p_from_level,
    p_to_level,
    p_from_score,
    p_to_score,
    p_dedupe_key
  )
  ON CONFLICT (student_id, alert_type, dedupe_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    PERFORM public.notify_engagement_alert_recipients(
      p_student_id,
      p_title,
      COALESCE(p_student_body, p_message),
      COALESCE(p_instructor_body, p_message)
    );
  END IF;

  RETURN v_id;
END;
$$;

-- Unique constraint is declared on the table definition above.

-- ── 6. Evaluate alerts after recompute / on demand ───────────────────────────
CREATE OR REPLACE FUNCTION public.evaluate_engagement_alerts(p_student_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_level TEXT;
  v_prev_level TEXT;
  v_score NUMERIC;
  v_prev_score NUMERIC;
  v_last_login TIMESTAMPTZ;
  v_days INTEGER;
  v_name TEXT;
  v_drop_pct NUMERIC;
BEGIN
  SELECT
    engagement_level,
    previous_engagement_level,
    engagement_score,
    previous_engagement_score,
    last_login_at
  INTO v_level, v_prev_level, v_score, v_prev_score, v_last_login
  FROM public.student_engagement_summary
  WHERE student_id = p_student_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(NULLIF(trim(full_name), ''), 'A student')
  INTO v_name
  FROM public.profiles
  WHERE user_id = p_student_id
  LIMIT 1;

  v_name := COALESCE(v_name, 'A student');

  -- Score drop > 20%
  IF v_prev_score IS NOT NULL AND v_prev_score > 0 AND v_score IS NOT NULL THEN
    v_drop_pct := ((v_prev_score - v_score) / v_prev_score) * 100;
    IF v_drop_pct > 20 THEN
      PERFORM public.create_engagement_alert(
        p_student_id,
        'score_drop_20',
        'Engagement score dropped',
        format('Engagement score fell from %s to %s (%s%% drop).',
          round(v_prev_score::numeric, 1), round(v_score::numeric, 1), round(v_drop_pct::numeric, 1)),
        format('score_drop:%s->%s', round(v_prev_score::numeric, 1), round(v_score::numeric, 1)),
        v_prev_level,
        v_level,
        v_prev_score,
        v_score,
        format('Your engagement score dropped from %s to %s. Visit EDGE to get back on track.',
          round(v_prev_score::numeric, 1), round(v_score::numeric, 1)),
        format('%s engagement score dropped from %s to %s (%s%%).',
          v_name, round(v_prev_score::numeric, 1), round(v_score::numeric, 1), round(v_drop_pct::numeric, 1))
      );
    END IF;
  END IF;

  -- Active (high / very_high) → Low Engagement (moderate)
  IF v_prev_level IN ('high', 'very_high') AND v_level = 'moderate' THEN
    PERFORM public.create_engagement_alert(
      p_student_id,
      'active_to_low',
      'Engagement changed to Low Engagement',
      format('Engagement moved from Active to Low Engagement.'),
      format('level:%s->%s', v_prev_level, v_level),
      v_prev_level,
      v_level,
      v_prev_score,
      v_score,
      'Your engagement changed from Active to Low Engagement. Log in and participate to improve.',
      format('%s engagement changed from Active to Low Engagement.', v_name)
    );
  END IF;

  -- Low Engagement (moderate) → Inactive (low)
  IF v_prev_level = 'moderate' AND v_level = 'low' THEN
    PERFORM public.create_engagement_alert(
      p_student_id,
      'low_to_inactive',
      'Engagement changed to Inactive',
      format('Engagement moved from Low Engagement to Inactive.'),
      format('level:%s->%s', v_prev_level, v_level),
      v_prev_level,
      v_level,
      v_prev_score,
      v_score,
      'Your engagement is now Inactive. Please return to EDGE and reconnect with your courses.',
      format('%s engagement changed from Low Engagement to Inactive.', v_name)
    );
  END IF;

  -- Inactivity based on last_login_at
  IF v_last_login IS NOT NULL THEN
    v_days := FLOOR(EXTRACT(EPOCH FROM (now() - v_last_login)) / 86400)::

    IF v_days >= 7 THEN
      PERFORM public.create_engagement_alert(
        p_student_id,
        'no_login_7_days',
        'No login for 7 days',
        format('Student has not logged in for %s days.', v_days),
        format('no_login_7:%s', v_last_login::text),
        NULL, v_level, NULL, v_score,
        format('You have not logged in for %s days. Please return to EDGE.', v_days),
        format('%s has not logged in for %s days.', v_name, v_days)
      );
    ELSIF v_days >= 3 THEN
      PERFORM public.create_engagement_alert(
        p_student_id,
        'no_login_3_days',
        'No login for 3 days',
        format('Student has not logged in for %s days.', v_days),
        format('no_login_3:%s', v_last_login::text),
        NULL, v_level, NULL, v_score,
        format('You have not logged in for %s days. A short check-in helps keep you on track.', v_days),
        format('%s has not logged in for %s days.', v_name, v_days)
      );
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.evaluate_engagement_alerts(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_engagement_alerts(UUID) TO service_role;

-- Scan all students with engagement summaries (for inactivity without new activity)
CREATE OR REPLACE FUNCTION public.scan_engagement_inactivity_alerts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR r IN SELECT student_id FROM public.student_engagement_summary LOOP
    PERFORM public.evaluate_engagement_alerts(r.student_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.scan_engagement_inactivity_alerts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.scan_engagement_inactivity_alerts() TO service_role;

-- ── 7. Patch recompute to keep previous_engagement_score + evaluate alerts ────
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
  v_prev_score NUMERIC;

  v_logins_per_week NUMERIC;
  v_hours_per_week NUMERIC;
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

  SELECT COUNT(*)
  INTO v_login_count_window
  FROM public.student_login_history
  WHERE student_id = p_student_id
    AND COALESCE(counts_as_login, true) = true
    AND login_time >= v_window_start;

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

  SELECT COUNT(*) INTO v_assignments_viewed
  FROM public.student_activity
  WHERE student_id = p_student_id AND activity_type = 'assignment_view';

  SELECT COUNT(*) INTO v_assignments_submitted
  FROM public.student_activity
  WHERE student_id = p_student_id
    AND activity_type IN ('assignment_submit', 'quiz_complete');

  IF COALESCE(v_assignments_submitted, 0) = 0 THEN
    SELECT COUNT(*) INTO v_assignments_submitted
    FROM public.submissions WHERE student_id = p_student_id;
  END IF;

  SELECT COUNT(*) INTO v_ai_sessions
  FROM public.student_activity
  WHERE student_id = p_student_id
    AND activity_type IN ('ai_session', 'view_coaching');

  SELECT COUNT(*) INTO v_feedback_count
  FROM public.student_engagement_feedback
  WHERE student_id = p_student_id;

  SELECT COUNT(*) INTO v_participation
  FROM public.student_activity
  WHERE student_id = p_student_id AND created_at >= v_window_start;

  SELECT COUNT(*) INTO v_modules
  FROM public.student_activity
  WHERE student_id = p_student_id
    AND created_at >= v_window_start
    AND activity_type IN ('view_material', 'open_module', 'view_file', 'view_subject_page', 'page_visit');

  SELECT COUNT(*) INTO v_announcements
  FROM public.student_activity
  WHERE student_id = p_student_id
    AND created_at >= v_window_start
    AND activity_type = 'read_announcement';

  SELECT COUNT(*) INTO v_quizzes
  FROM public.student_activity
  WHERE student_id = p_student_id
    AND created_at >= v_window_start
    AND activity_type = 'quiz_complete';

  SELECT COUNT(*) INTO v_assign_window
  FROM public.student_activity
  WHERE student_id = p_student_id
    AND created_at >= v_window_start
    AND activity_type IN ('assignment_view', 'assignment_submit', 'quiz_complete');

  IF COALESCE(v_assign_window, 0) = 0 THEN
    SELECT COUNT(*) INTO v_assign_window
    FROM public.submissions
    WHERE student_id = p_student_id AND submitted_at >= v_window_start;
  END IF;

  SELECT
    (SELECT COUNT(*) FROM public.student_activity
     WHERE student_id = p_student_id AND created_at >= v_window_start
       AND activity_type IN ('ai_session', 'view_coaching'))
    +
    (SELECT COUNT(*) FROM public.student_engagement_feedback
     WHERE student_id = p_student_id AND created_at >= v_window_start)
  INTO v_ai_fb_window;

  v_logins_per_week := COALESCE(v_login_count_window, 0)::NUMERIC / v_weeks;
  v_login_score := LEAST(100, (v_logins_per_week / 5.0) * 100);
  v_hours_per_week := (COALESCE(v_window_seconds, 0)::NUMERIC / 3600.0) / v_weeks;
  v_time_score := LEAST(100, (v_hours_per_week / 5.0) * 100);
  v_assignment_score := LEAST(100, (COALESCE(v_assign_window, 0)::NUMERIC / 10.0) * 100);
  v_ai_feedback_score := LEAST(100, (COALESCE(v_ai_fb_window, 0)::NUMERIC / 5.0) * 100);

  v_engagement_score := ROUND(
    v_login_score * 0.40 +
    v_time_score * 0.30 +
    v_assignment_score * 0.20 +
    v_ai_feedback_score * 0.10,
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

  SELECT engagement_level, engagement_score
  INTO v_prev_level, v_prev_score
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
    previous_engagement_score,
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
    CASE WHEN v_prev_level IS NOT NULL AND v_prev_level <> v_level THEN v_prev_level ELSE NULL END,
    CASE
      WHEN v_prev_score IS NOT NULL AND v_prev_score IS DISTINCT FROM v_engagement_score THEN v_prev_score
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
    previous_engagement_score = CASE
      WHEN student_engagement_summary.engagement_score IS DISTINCT FROM EXCLUDED.engagement_score
      THEN student_engagement_summary.engagement_score
      ELSE student_engagement_summary.previous_engagement_score
    END,
    updated_at = now();

  PERFORM public.evaluate_engagement_alerts(p_student_id);
END;
$$;

-- Realtime for instructor dashboards
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.engagement_alerts;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.engagement_interventions;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- Instructor-facing RPC: log intervention + optional student inbox notify
CREATE OR REPLACE FUNCTION public.log_engagement_intervention(
  p_student_id UUID,
  p_action_type TEXT,
  p_note TEXT DEFAULT NULL,
  p_alert_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_notify_student BOOLEAN DEFAULT true
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_title TEXT;
  v_body TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT public.instructor_can_view_student(p_student_id)
     AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_action_type NOT IN (
    'send_reminder',
    'send_email_reminder',
    'schedule_consultation',
    'add_note',
    'mark_contacted'
  ) THEN
    RAISE EXCEPTION 'invalid action_type';
  END IF;

  INSERT INTO public.engagement_interventions (
    alert_id,
    student_id,
    instructor_id,
    action_type,
    note,
    metadata
  ) VALUES (
    p_alert_id,
    p_student_id,
    auth.uid(),
    p_action_type,
    NULLIF(trim(COALESCE(p_note, '')), ''),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  IF p_action_type = 'mark_contacted' AND p_alert_id IS NOT NULL THEN
    UPDATE public.engagement_alerts
    SET
      status = 'acknowledged',
      acknowledged_by = auth.uid(),
      acknowledged_at = now(),
      updated_at = now()
    WHERE id = p_alert_id
      AND student_id = p_student_id;
  END IF;

  IF p_notify_student AND p_action_type IN ('send_reminder', 'schedule_consultation', 'send_email_reminder') THEN
    IF p_action_type = 'schedule_consultation' THEN
      v_title := 'Consultation scheduled';
      v_body := COALESCE(
        NULLIF(trim(COALESCE(p_note, '')), ''),
        'Your instructor scheduled a consultation about your engagement. Please check EDGE.'
      );
    ELSE
      v_title := 'Engagement reminder';
      v_body := COALESCE(
        NULLIF(trim(COALESCE(p_note, '')), ''),
        'Your instructor sent an engagement reminder. Please log in to EDGE.'
      );
    END IF;

    INSERT INTO public.user_inbox_notifications (user_id, title, body)
    VALUES (p_student_id, v_title, v_body);
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_engagement_intervention(UUID, TEXT, TEXT, UUID, JSONB, BOOLEAN)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_engagement_intervention(UUID, TEXT, TEXT, UUID, JSONB, BOOLEAN)
  TO service_role;

