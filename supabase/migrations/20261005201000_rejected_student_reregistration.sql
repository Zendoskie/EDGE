-- A rejected student request is history, not an active account.
-- An approved request also stops blocking once it has no active account,
-- so the same email and Student ID can be submitted again.
-- Pending requests and active accounts still block.

CREATE OR REPLACE FUNCTION public.validate_student_signup(p_student_id_no text, p_parent_email text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_student_id text;
BEGIN
  v_student_id := NULLIF(trim(p_student_id_no), '');
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'student_id_required' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE lower(trim(student_id)) = lower(v_student_id)
      AND COALESCE(account_status, 'approved') NOT IN ('rejected', 'deactivated')
  ) OR EXISTS (
    SELECT 1
    FROM public.student_registration_requests
    WHERE lower(trim(student_id)) = lower(v_student_id)
      AND status = 'pending'
  ) OR EXISTS (
    SELECT 1
    FROM public.student_registration_requests request
    WHERE lower(trim(request.student_id)) = lower(v_student_id)
      AND request.status = 'approved'
      AND (
        EXISTS (
          SELECT 1
          FROM auth.users account
          LEFT JOIN public.profiles profile ON profile.user_id = account.id
          WHERE lower(account.email) = lower(trim(request.email))
            AND COALESCE(profile.account_status, 'approved') NOT IN ('rejected', 'deactivated')
        )
        OR EXISTS (
          SELECT 1
          FROM public.profiles profile
          WHERE lower(trim(profile.email)) = lower(trim(request.email))
            AND COALESCE(profile.account_status, 'approved') NOT IN ('rejected', 'deactivated')
        )
      )
  ) THEN
    RAISE EXCEPTION 'student_id_in_use' USING ERRCODE = '23505';
  END IF;
END;
$function$;

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

  IF EXISTS (
    SELECT 1
    FROM auth.users account
    LEFT JOIN public.profiles profile ON profile.user_id = account.id
    WHERE lower(account.email) = v_email
      AND COALESCE(profile.account_status, 'approved') NOT IN ('rejected', 'deactivated')
  ) OR EXISTS (
    SELECT 1
    FROM public.profiles profile
    WHERE lower(trim(profile.email)) = v_email
      AND COALESCE(profile.account_status, 'approved') NOT IN ('rejected', 'deactivated')
  ) THEN
    RAISE EXCEPTION 'email_already_registered' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.student_registration_requests
    WHERE lower(trim(email)) = v_email
      AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'request_already_pending' USING ERRCODE = '23505';
  END IF;

  PERFORM public.validate_student_signup(v_student_id);

  UPDATE public.staff_invitations
  SET status = 'revoked'
  WHERE role = 'student'::public.app_role
    AND status = 'pending'
    AND lower(trim(email)) = v_email;

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

REVOKE ALL ON FUNCTION public.validate_student_signup(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_student_signup(text, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.submit_student_registration_request(text, text, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_student_registration_request(text, text, text, text, text, boolean) TO anon, authenticated;
