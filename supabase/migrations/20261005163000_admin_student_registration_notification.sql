-- Tell each admin once when a student registration request is created.
-- Does not change approval, invitation, or account-status behavior.

CREATE OR REPLACE FUNCTION public.submit_student_registration_request(
  p_full_name    text,
  p_email        text,
  p_student_id   text,
  p_course       text,
  p_year_level   text,
  p_is_irregular boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_name text;
  v_email text;
  v_student_id text;
  v_course text;
  v_year text;
  v_id uuid;
  v_submitted timestamptz;
  v_body text;
BEGIN
  v_name := NULLIF(trim(p_full_name), '');
  v_email := lower(NULLIF(trim(p_email), ''));
  v_student_id := NULLIF(trim(p_student_id), '');
  v_course := NULLIF(trim(p_course), '');
  v_year := NULLIF(trim(p_year_level), '');

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'full_name_required' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'email_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_student_id IS NULL OR v_student_id !~ '^\d{2}-\d-\d-\d{4}$' THEN
    RAISE EXCEPTION 'student_id_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_course IS NULL THEN
    RAISE EXCEPTION 'course_required' USING ERRCODE = '22023';
  END IF;
  IF v_year IS NULL OR v_year NOT IN ('1st Year', '2nd Year', '3rd Year', '4th Year', 'Irregular') THEN
    RAISE EXCEPTION 'year_level_invalid' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = v_email)
     OR EXISTS (SELECT 1 FROM public.profiles p WHERE lower(trim(p.email)) = v_email) THEN
    RAISE EXCEPTION 'email_already_registered' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.student_registration_requests
    WHERE lower(email) = v_email
      AND status IN ('pending', 'approved')
  ) THEN
    RAISE EXCEPTION 'request_already_pending' USING ERRCODE = '23505';
  END IF;

  PERFORM public.validate_student_signup(v_student_id);

  INSERT INTO public.student_registration_requests (
    full_name, email, student_id, course, year_level, is_irregular, status
  )
  VALUES (
    v_name, v_email, v_student_id, v_course, v_year, COALESCE(p_is_irregular, false), 'pending'
  )
  RETURNING id, submitted_at INTO v_id, v_submitted;

  v_body := 'New student account registration request from ' || v_name
    || '. Status: Pending. Submitted '
    || to_char(v_submitted, 'YYYY-MM-DD HH24:MI')
    || '.';

  INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
  SELECT
    admin_role.user_id,
    'Student registration request',
    v_body,
    v_name
  FROM public.user_roles admin_role
  WHERE admin_role.role = 'admin'::public.app_role
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_inbox_notifications existing
      WHERE existing.user_id = admin_role.user_id
        AND existing.title = 'Student registration request'
        AND existing.body = v_body
    );

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_student_registration_request(text, text, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_student_registration_request(text, text, text, text, text, boolean) TO anon, authenticated;
