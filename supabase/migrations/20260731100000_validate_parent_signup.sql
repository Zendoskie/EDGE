-- Pre-signup validation for parent/guardian registration.
-- GoTrue wraps trigger-raised exceptions in a generic "Database error saving new user",
-- so the specific messages (parent_email_not_set, parent_email_mismatch, etc.) never
-- reach the client. This function lets the signup form validate BEFORE calling signUp
-- and surface a friendly message instead.
--
-- Security: does NOT return the stored parent email. It only reports whether the
-- supplied email matches, so no email address is exposed to unauthenticated callers.
CREATE OR REPLACE FUNCTION public.validate_parent_signup(p_student_id_no text, p_parent_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_user_id uuid;
  v_student_parent_email text;
  v_email text;
BEGIN
  v_email := NULLIF(trim(p_parent_email), '');
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'parent_email_required' USING ERRCODE = '22023';
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
