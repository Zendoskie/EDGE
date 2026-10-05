-- Close the leftover notification gaps:
-- a second real counseling referral is its own inbox event,
-- and an instructor can reply on a feedback row they are allowed to see.

ALTER TABLE public.user_inbox_notifications
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS user_inbox_notifications_user_dedupe_key_idx
  ON public.user_inbox_notifications (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.notify_student_counseling_referral()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid;
  v_name text;
  v_body text;
  v_title text := 'Counseling referral';
  v_event text;
BEGIN
  IF NEW.student_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_actor := COALESCE(auth.uid(), NEW.instructor_id);
    v_event := 'created';
  ELSIF TG_OP = 'UPDATE'
        AND NEW.status IN ('approved', 'rejected')
        AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_actor := COALESCE(NEW.reviewed_by, auth.uid(), NEW.instructor_id);
    v_event := NEW.status;
  ELSE
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(trim(profile.full_name), ''), NULLIF(trim(profile.email), ''), 'your counselor')
  INTO v_name
  FROM public.profiles profile
  WHERE profile.user_id = v_actor;

  v_name := COALESCE(v_name, 'your counselor');

  IF TG_OP = 'UPDATE' AND NEW.status = 'rejected' THEN
    v_body := 'Your counseling referral from ' || v_name || ' was not approved.';
  ELSE
    v_body := 'You received a counseling referral from ' || v_name || '.';
    IF TG_OP = 'INSERT' THEN
      v_body := v_body || ' Status: Pending.';
    END IF;
  END IF;

  INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name, dedupe_key)
  VALUES (
    NEW.student_id,
    v_title,
    v_body,
    v_name,
    'counseling-referral:' || NEW.id::text || ':' || v_event
  )
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_student_counseling_referral() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.student_engagement_feedback
  ADD COLUMN IF NOT EXISTS instructor_response text;

ALTER TABLE public.student_feedback
  ADD COLUMN IF NOT EXISTS instructor_response text;

CREATE OR REPLACE FUNCTION public.keep_instructor_feedback_response()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT DISTINCT FROM NEW.student_id THEN
    NEW.instructor_response := OLD.instructor_response;
    IF TG_TABLE_NAME = 'student_engagement_feedback' THEN
      NEW.status := OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.keep_instructor_feedback_response() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS keep_engagement_feedback_response ON public.student_engagement_feedback;
CREATE TRIGGER keep_engagement_feedback_response
BEFORE UPDATE ON public.student_engagement_feedback
FOR EACH ROW
EXECUTE FUNCTION public.keep_instructor_feedback_response();

DROP TRIGGER IF EXISTS keep_student_feedback_response ON public.student_feedback;
CREATE TRIGGER keep_student_feedback_response
BEFORE UPDATE ON public.student_feedback
FOR EACH ROW
EXECUTE FUNCTION public.keep_instructor_feedback_response();

CREATE OR REPLACE FUNCTION public.instructor_reply_to_feedback(
  p_kind text,
  p_feedback_id uuid,
  p_response text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_student uuid;
  v_label text;
  v_name text;
  v_response text := NULLIF(trim(p_response), '');
  v_body text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_role(v_caller, 'instructor'::public.app_role) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF v_response IS NULL OR char_length(v_response) > 2000 THEN
    RAISE EXCEPTION 'Enter a reply of 2000 characters or fewer';
  END IF;

  IF p_kind = 'engagement' THEN
    SELECT feedback.student_id, COALESCE(NULLIF(trim(feedback.subject), ''), 'your course')
    INTO v_student, v_label
    FROM public.student_engagement_feedback feedback
    WHERE feedback.id = p_feedback_id;

    IF v_student IS NULL OR NOT public.instructor_can_view_student(v_student) THEN
      RAISE EXCEPTION 'Not allowed';
    END IF;

    UPDATE public.student_engagement_feedback
    SET instructor_response = v_response,
        status = CASE WHEN status = 'submitted' THEN 'reviewed' ELSE status END
    WHERE id = p_feedback_id;
  ELSIF p_kind = 'struggle' THEN
    SELECT feedback.student_id, COALESCE(NULLIF(trim(subject.code), ''), 'your course')
    INTO v_student, v_label
    FROM public.student_feedback feedback
    JOIN public.subjects subject ON subject.id = feedback.subject_id
    WHERE feedback.id = p_feedback_id
      AND subject.instructor_id = v_caller;

    IF v_student IS NULL THEN
      RAISE EXCEPTION 'Not allowed';
    END IF;

    UPDATE public.student_feedback
    SET instructor_response = v_response
    WHERE id = p_feedback_id;
  ELSE
    RAISE EXCEPTION 'Not allowed';
  END IF;

  SELECT COALESCE(NULLIF(trim(profile.full_name), ''), NULLIF(trim(profile.email), ''), 'Your instructor')
  INTO v_name
  FROM public.profiles profile
  WHERE profile.user_id = v_caller;

  v_name := COALESCE(v_name, 'Your instructor');
  v_body := 'Your instructor replied to your feedback for ' || v_label || '.';

  INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name, dedupe_key)
  VALUES (
    v_student,
    'Feedback reply',
    v_body,
    v_name,
    'feedback-reply:' || p_kind || ':' || p_feedback_id::text || ':' || md5(v_response)
  )
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.instructor_reply_to_feedback(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.instructor_reply_to_feedback(text, uuid, text) TO authenticated;
