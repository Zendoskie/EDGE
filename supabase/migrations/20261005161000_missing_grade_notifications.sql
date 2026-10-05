-- Notify an active student once when an activity's grades are published
-- and that student still has no recorded score. Does not change scoring.

CREATE OR REPLACE FUNCTION public.notify_missing_activity_grades(p_activity_id uuid)
RETURNS TABLE (
  student_id uuid,
  email text,
  notification_body text,
  subject_code text,
  subject_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_subject_id uuid;
  v_title text;
  v_code text;
  v_subject_name text;
  v_instructor uuid;
  v_source text;
  v_body text;
  v_student uuid;
  v_email text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT activity.subject_id, activity.title, subject.code, subject.name, subject.instructor_id
  INTO v_subject_id, v_title, v_code, v_subject_name, v_instructor
  FROM public.activities activity
  JOIN public.subjects subject ON subject.id = activity.subject_id
  WHERE activity.id = p_activity_id;

  IF v_subject_id IS NULL THEN
    RAISE EXCEPTION 'Activity not found';
  END IF;

  IF v_instructor IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'You do not have access to this activity';
  END IF;

  UPDATE public.activities
  SET
    grades_published_at = COALESCE(grades_published_at, now()),
    grades_published_by = COALESCE(grades_published_by, v_caller)
  WHERE id = p_activity_id;

  SELECT COALESCE(NULLIF(trim(profile.full_name), ''), 'the instructor')
  INTO v_source
  FROM public.profiles profile
  WHERE profile.user_id = v_caller;

  v_body := 'You have a missing grade for '
    || COALESCE(NULLIF(trim(v_title), ''), 'an activity')
    || ' in '
    || COALESCE(NULLIF(trim(v_code), ''), 'your subject')
    || '.';

  FOR v_student, v_email IN
    SELECT enrollment.student_id, profile.email
    FROM public.enrollments enrollment
    LEFT JOIN public.profiles profile ON profile.user_id = enrollment.student_id
    WHERE enrollment.subject_id = v_subject_id
      AND enrollment.status = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM public.submissions submission
        WHERE submission.activity_id = p_activity_id
          AND submission.student_id = enrollment.student_id
          AND submission.score IS NOT NULL
      )
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.user_inbox_notifications notification
      WHERE notification.user_id = v_student
        AND notification.title = 'Missing grade'
        AND notification.body = v_body
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
    VALUES (v_student, 'Missing grade', v_body, COALESCE(v_source, 'the instructor'));

    student_id := v_student;
    email := v_email;
    notification_body := v_body;
    subject_code := v_code;
    subject_name := v_subject_name;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_missing_activity_grades(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_missing_activity_grades(uuid) TO authenticated;
