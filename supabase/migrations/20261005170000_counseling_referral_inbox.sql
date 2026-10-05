-- Student dashboard notification for the same referral event that already sends email.
-- One row per student per event. Does not change the referral record or the email function.

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
BEGIN
  IF NEW.student_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_actor := COALESCE(auth.uid(), NEW.instructor_id);
  ELSIF TG_OP = 'UPDATE'
        AND NEW.status IN ('approved', 'rejected')
        AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_actor := COALESCE(NEW.reviewed_by, auth.uid(), NEW.instructor_id);
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

  IF EXISTS (
    SELECT 1
    FROM public.user_inbox_notifications existing
    WHERE existing.user_id = NEW.student_id
      AND existing.title = v_title
      AND existing.body = v_body
      AND existing.created_at > now() - interval '2 minutes'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
  VALUES (NEW.student_id, v_title, v_body, v_name);

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_student_counseling_referral() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_student_counseling_referral ON public.counseling_referrals;
CREATE TRIGGER trg_notify_student_counseling_referral
AFTER INSERT OR UPDATE OF status, reviewed_by ON public.counseling_referrals
FOR EACH ROW
EXECUTE FUNCTION public.notify_student_counseling_referral();
