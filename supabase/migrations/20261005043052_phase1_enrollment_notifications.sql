-- Enrollment status, first-grade, and intervention notifications.
-- Reuses user_inbox_notifications. Does not broaden who can read another user's rows.

DROP POLICY IF EXISTS "Students can reopen a rejected enrollment" ON public.enrollments;
CREATE POLICY "Students can reopen a rejected enrollment"
  ON public.enrollments
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = student_id AND status = 'rejected')
  WITH CHECK (auth.uid() = student_id AND status = 'pending');

CREATE OR REPLACE FUNCTION public.notify_enrollment_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code text;
  v_instructor uuid;
  v_student_name text;
  v_instructor_name text;
BEGIN
  SELECT subject.code, subject.instructor_id
  INTO v_code, v_instructor
  FROM public.subjects subject
  WHERE subject.id = NEW.subject_id;

  IF NEW.status = 'pending'
     AND v_instructor IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'pending') THEN
    SELECT COALESCE(NULLIF(trim(profile.full_name), ''), 'A student')
    INTO v_student_name
    FROM public.profiles profile
    WHERE profile.user_id = NEW.student_id;

    INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
    VALUES (
      v_instructor,
      'Enrollment request',
      v_student_name || ' requested to enroll in ' || COALESCE(v_code, 'a subject') || '.',
      v_student_name
    );
  ELSIF TG_OP = 'UPDATE'
        AND NEW.status = 'rejected'
        AND OLD.status IS DISTINCT FROM 'rejected' THEN
    SELECT COALESCE(NULLIF(trim(profile.full_name), ''), 'the instructor')
    INTO v_instructor_name
    FROM public.profiles profile
    WHERE profile.user_id = v_instructor;

    INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
    VALUES (
      NEW.student_id,
      'Enrollment request rejected',
      'Your enrollment request for ' || COALESCE(v_code, 'a subject')
        || ' was rejected by ' || COALESCE(v_instructor_name, 'the instructor') || '.',
      COALESCE(v_instructor_name, 'the instructor')
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_enrollment_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_enrollment_status ON public.enrollments;
CREATE TRIGGER trg_notify_enrollment_status
AFTER INSERT OR UPDATE OF status ON public.enrollments
FOR EACH ROW
EXECUTE FUNCTION public.notify_enrollment_status();

CREATE OR REPLACE FUNCTION public.notify_first_activity_grade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_title text;
  v_code text;
  v_instructor uuid;
  v_instructor_name text;
BEGIN
  IF NEW.student_id IS NULL OR NEW.score IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.score IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT activity.title, subject.code, subject.instructor_id
  INTO v_title, v_code, v_instructor
  FROM public.activities activity
  LEFT JOIN public.subjects subject ON subject.id = activity.subject_id
  WHERE activity.id = NEW.activity_id;

  SELECT COALESCE(NULLIF(trim(profile.full_name), ''), 'the instructor')
  INTO v_instructor_name
  FROM public.profiles profile
  WHERE profile.user_id = COALESCE(NEW.graded_by, v_instructor);

  INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
  VALUES (
    NEW.student_id,
    'Grade posted',
    COALESCE(v_code, 'Your subject') || ': ' || COALESCE(v_title, 'an activity')
      || ' was graded ' || NEW.score::text
      || ' by ' || COALESCE(v_instructor_name, 'the instructor') || '.',
    COALESCE(v_instructor_name, 'the instructor')
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_first_activity_grade() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_first_activity_grade ON public.submissions;
CREATE TRIGGER trg_notify_first_activity_grade
AFTER INSERT OR UPDATE OF score ON public.submissions
FOR EACH ROW
EXECUTE FUNCTION public.notify_first_activity_grade();

CREATE OR REPLACE FUNCTION public.notify_intervention_logged()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code text;
  v_instructor_name text;
  v_when text;
BEGIN
  IF NEW.student_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT subject.code, COALESCE(NULLIF(trim(profile.full_name), ''), 'Your instructor')
  INTO v_code, v_instructor_name
  FROM public.subjects subject
  LEFT JOIN public.profiles profile ON profile.user_id = subject.instructor_id
  WHERE subject.id = NEW.subject_id;

  v_when := to_char(COALESCE(NEW.sent_at, now()), 'YYYY-MM-DD HH24:MI');

  INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
  VALUES (
    NEW.student_id,
    'Intervention logged',
    COALESCE(v_instructor_name, 'Your instructor')
      || ' logged a ' || COALESCE(NEW.type, 'support') || ' intervention'
      || CASE WHEN v_code IS NOT NULL THEN ' for ' || v_code ELSE '' END
      || ' on ' || v_when || '.'
      || CASE
           WHEN NULLIF(trim(COALESCE(NEW.message, '')), '') IS NOT NULL
             THEN E'\n\n' || trim(NEW.message)
           ELSE ''
         END
      || E'\n\nOpen Insights to view this intervention.',
    COALESCE(v_instructor_name, 'Your instructor')
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_intervention_logged() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_intervention_logged ON public.interventions;
CREATE TRIGGER trg_notify_intervention_logged
AFTER INSERT ON public.interventions
FOR EACH ROW
EXECUTE FUNCTION public.notify_intervention_logged();

CREATE OR REPLACE FUNCTION public.referral_reviewer_names(p_ids uuid[])
RETURNS TABLE (referral_id uuid, reviewer_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT referral.id, COALESCE(NULLIF(trim(profile.full_name), ''), NULLIF(trim(profile.email), ''))
  FROM public.counseling_referrals referral
  JOIN public.profiles profile ON profile.user_id = referral.reviewed_by
  WHERE referral.id = ANY (p_ids)
    AND referral.reviewed_by IS NOT NULL
    AND (
      referral.student_id = auth.uid()
      OR referral.instructor_id = auth.uid()
      OR public.has_role(auth.uid(), 'guidance_counselor'::public.app_role)
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    );
$$;

REVOKE ALL ON FUNCTION public.referral_reviewer_names(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_reviewer_names(uuid[]) TO authenticated;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.user_inbox_notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
