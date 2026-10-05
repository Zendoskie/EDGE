-- Approval must say the referral was approved. Rejection text stays as it is.
-- The previous approval row reused the "you received a referral" sentence, so the
-- student dashboard did not show a distinct approval alert.

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
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'approved' THEN
    v_body := 'Your counseling referral from ' || v_name || ' was approved.';
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
