-- Student and instructor counseling inbox triggers stay as they are.
-- A new referral already emails every guidance counselor. Store that same
-- notice in the inbox the counselor dashboard already reads.

CREATE OR REPLACE FUNCTION public.notify_counselor_counseling_referral()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_student text;
  v_subject text;
  v_instructor text;
  v_when text;
  v_body text;
  v_counselor uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(trim(profile.full_name), ''), NULLIF(trim(profile.email), ''), 'the student')
  INTO v_student
  FROM public.profiles profile
  WHERE profile.user_id = NEW.student_id;

  v_student := COALESCE(v_student, 'the student');

  SELECT COALESCE(NULLIF(trim(subject.code), ''), NULLIF(trim(subject.name), ''), 'the subject')
  INTO v_subject
  FROM public.subjects subject
  WHERE subject.id = NEW.subject_id;

  v_subject := COALESCE(v_subject, 'the subject');

  SELECT COALESCE(NULLIF(trim(profile.full_name), ''), NULLIF(trim(profile.email), ''), 'the instructor')
  INTO v_instructor
  FROM public.profiles profile
  WHERE profile.user_id = NEW.instructor_id;

  v_instructor := COALESCE(v_instructor, 'the instructor');
  v_when := to_char(COALESCE(NEW.created_at, now()) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI');
  v_body := 'New counseling referral for ' || v_student || ' in ' || v_subject
    || ' from ' || v_instructor || '. Status: Pending. Submitted ' || v_when || ' UTC.';

  FOR v_counselor IN
    SELECT role_row.user_id
    FROM public.user_roles role_row
    WHERE role_row.role = 'guidance_counselor'::public.app_role
  LOOP
    INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name, dedupe_key)
    VALUES (
      v_counselor,
      'Counseling referral',
      v_body,
      v_instructor,
      'counseling-referral-counselor:' || NEW.id::text || ':created'
    )
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_counselor_counseling_referral() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_counselor_counseling_referral ON public.counseling_referrals;
CREATE TRIGGER trg_notify_counselor_counseling_referral
AFTER INSERT ON public.counseling_referrals
FOR EACH ROW
EXECUTE FUNCTION public.notify_counselor_counseling_referral();
