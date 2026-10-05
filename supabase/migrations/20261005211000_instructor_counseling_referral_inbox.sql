-- The student counseling inbox trigger stays as it is.
-- Instructors were only emailed on a decision, and their dashboard bell
-- depended on a live browser session. Store the instructor notice in the
-- same inbox the dashboard already reads.

CREATE OR REPLACE FUNCTION public.notify_instructor_counseling_referral()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event text;
  v_student text;
  v_subject text;
  v_counselor text;
  v_when text;
  v_body text;
  v_source text;
BEGIN
  IF NEW.instructor_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_event := 'created';
    v_when := to_char(COALESCE(NEW.created_at, now()) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI');
  ELSIF TG_OP = 'UPDATE'
        AND NEW.status IN ('approved', 'rejected')
        AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_event := NEW.status;
    v_when := to_char(COALESCE(NEW.reviewed_at, now()) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI');
  ELSE
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

  IF v_event = 'created' THEN
    v_source := v_student;
    v_body := 'Counseling referral for ' || v_student || ' in ' || v_subject
      || ' was sent. Status: Pending. Submitted ' || v_when || ' UTC.';
  ELSE
    SELECT COALESCE(NULLIF(trim(profile.full_name), ''), NULLIF(trim(profile.email), ''), 'the guidance counselor')
    INTO v_counselor
    FROM public.profiles profile
    WHERE profile.user_id = COALESCE(NEW.reviewed_by, auth.uid());

    v_counselor := COALESCE(v_counselor, 'the guidance counselor');
    v_source := v_counselor;

    IF v_event = 'approved' THEN
      v_body := 'Counseling referral for ' || v_student || ' in ' || v_subject
        || ' was approved by ' || v_counselor || '. Status: Approved. Decided ' || v_when || ' UTC.';
    ELSE
      v_body := 'Counseling referral for ' || v_student || ' in ' || v_subject
        || ' was not approved by ' || v_counselor || '. Status: Rejected. Decided ' || v_when || ' UTC.';
    END IF;
  END IF;

  INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name, dedupe_key)
  VALUES (
    NEW.instructor_id,
    'Counseling referral',
    v_body,
    v_source,
    'counseling-referral-instructor:' || NEW.id::text || ':' || v_event
  )
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_instructor_counseling_referral() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_instructor_counseling_referral ON public.counseling_referrals;
CREATE TRIGGER trg_notify_instructor_counseling_referral
AFTER INSERT OR UPDATE OF status, reviewed_by ON public.counseling_referrals
FOR EACH ROW
EXECUTE FUNCTION public.notify_instructor_counseling_referral();
