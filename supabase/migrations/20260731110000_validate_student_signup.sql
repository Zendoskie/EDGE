-- Pre-signup validation for student registration.
-- 1) The app's existing duplicate Student No. check queries profiles as an anon user,
--    but profiles has no anon SELECT policy, so RLS silently returns zero rows and the
--    check never catches duplicates.
-- 2) When the DB trigger rejects a duplicate during signup, GoTrue wraps the error as a
--    generic "Database error saving new user", so the client cannot show a friendly message.
-- This function lets the signup form validate BEFORE calling signUp and surface a clear
-- error instead. SECURITY DEFINER + explicit grant keeps the check safe for anon callers.
CREATE OR REPLACE FUNCTION public.validate_student_signup(p_student_id_no text, p_parent_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id text;
  v_email text;
BEGIN
  v_student_id := NULLIF(trim(p_student_id_no), '');
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'student_id_required' USING ERRCODE = '22023';
  END IF;

  v_email := NULLIF(trim(p_parent_email), '');
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'parent_email_required' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE lower(trim(student_id)) = lower(v_student_id)
  ) THEN
    RAISE EXCEPTION 'student_id_in_use' USING ERRCODE = '23505';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_student_signup(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_student_signup(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.validate_student_signup(text, text) TO authenticated;
