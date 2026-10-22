-- Student dashboard notifications when a score is first recorded on a submission.
-- Email for the same event stays on the grades_posted Edge path; this trigger is the durable inbox source.

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
  v_dedupe_key text;
BEGIN
  IF NEW.student_id IS NULL OR NEW.score IS NULL THEN
    RETURN NEW;
  END IF;
  -- Existing policy: notify on first recorded score only, not on later score changes.
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

  v_dedupe_key := 'grade-posted:' || NEW.activity_id::text || ':' || NEW.student_id::text;

  INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name, dedupe_key)
  VALUES (
    NEW.student_id,
    'Grade posted',
    COALESCE(v_code, 'Your subject') || ': ' || COALESCE(v_title, 'an activity')
      || ' was graded ' || NEW.score::text
      || ' by ' || COALESCE(v_instructor_name, 'the instructor') || '.',
    COALESCE(v_instructor_name, 'the instructor'),
    v_dedupe_key
  )
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_first_activity_grade() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_first_activity_grade ON public.submissions;
CREATE TRIGGER trg_notify_first_activity_grade
AFTER INSERT OR UPDATE OF score ON public.submissions
FOR EACH ROW
EXECUTE FUNCTION public.notify_first_activity_grade();
