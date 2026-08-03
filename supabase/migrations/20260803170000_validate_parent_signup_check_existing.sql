-- Extend validate_parent_signup to detect whether the prospective parent email
-- already has an account in auth.users (zombie from a prior failed trigger, or a
-- real account under a different role).  Without this check the RPC passes but
-- supabase.auth.signUp() immediately returns "User already registered", giving
-- the user no actionable feedback.
--
-- The check is placed BEFORE the student-lookup so the caller gets a clear
-- "email already registered" error rather than "student not found".

CREATE OR REPLACE FUNCTION public.validate_parent_signup(p_student_id_no text, p_parent_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email              text;
  v_student_user_id    uuid;
  v_student_parent_email text;
BEGIN
  v_email := NULLIF(trim(p_parent_email), '');
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'parent_email_required' USING ERRCODE = '22023';
  END IF;

  -- Check whether the email is already registered in auth.users.
  -- This catches zombie users (prior failed trigger) and accounts under other roles.
  IF EXISTS (
    SELECT 1
    FROM auth.users
    WHERE lower(trim(email)) = lower(v_email)
  ) THEN
    RAISE EXCEPTION 'parent_email_already_registered' USING ERRCODE = '23505';
  END IF;

  SELECT p.user_id, p.parent_email
  INTO v_student_user_id, v_student_parent_email
  FROM public.profiles p
  JOIN public.user_roles ur
    ON ur.user_id = p.user_id
   AND ur.role = 'student'::app_role
  WHERE p.student_id = NULLIF(trim(p_student_id_no), '')
  LIMIT 1;

  IF v_student_user_id IS NULL THEN
    RAISE EXCEPTION 'student_not_found_for_guardian_link' USING ERRCODE = 'P0002';
  END IF;

  IF v_student_parent_email IS NULL OR trim(v_student_parent_email) = '' THEN
    RAISE EXCEPTION 'parent_email_not_set' USING ERRCODE = '22023';
  END IF;

  IF lower(trim(v_email)) <> lower(trim(v_student_parent_email)) THEN
    RAISE EXCEPTION 'parent_email_mismatch' USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_parent_signup(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_parent_signup(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.validate_parent_signup(text, text) TO authenticated;
