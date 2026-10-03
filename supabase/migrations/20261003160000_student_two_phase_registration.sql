-- Student signup follows the staff two-phase flow:
--   1. Public request (Student ID + details, no password) stays pending.
--   2. Admin approval creates a single-use invitation on staff_invitations.
--   3. The student sets a password from that link and the account becomes active.
-- Staff request review and complete_staff_invitation are unchanged.

CREATE TABLE IF NOT EXISTS public.student_registration_requests (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name        text        NOT NULL,
  email            text        NOT NULL,
  student_id       text        NOT NULL,
  course           text        NOT NULL,
  year_level       text        NOT NULL,
  is_irregular     boolean     NOT NULL DEFAULT false,
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  reviewed_at      timestamptz,
  reviewed_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  rejection_reason text
);

CREATE INDEX IF NOT EXISTS idx_student_reg_requests_status_submitted
  ON public.student_registration_requests (status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_reg_requests_email
  ON public.student_registration_requests (lower(email));

CREATE INDEX IF NOT EXISTS idx_student_reg_requests_student_id
  ON public.student_registration_requests (lower(student_id));

ALTER TABLE public.student_registration_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view student registration requests"
  ON public.student_registration_requests;
CREATE POLICY "Admins can view student registration requests"
ON public.student_registration_requests
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE public.staff_invitations
  ADD COLUMN IF NOT EXISTS student_request_id uuid
  REFERENCES public.student_registration_requests(id) ON DELETE SET NULL;

ALTER TABLE public.staff_invitations DROP CONSTRAINT IF EXISTS staff_invitations_role_check;
ALTER TABLE public.staff_invitations
  ADD CONSTRAINT staff_invitations_role_check
  CHECK (role IN ('instructor', 'guidance_counselor', 'student'));

CREATE INDEX IF NOT EXISTS idx_staff_invitations_student_request
  ON public.staff_invitations (student_request_id);

-- Keep the existing student-id check, and also reserve IDs that are already
-- in an open student request. Does not return any other student's data.
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
  ) OR EXISTS (
    SELECT 1
    FROM public.student_registration_requests
    WHERE lower(trim(student_id)) = lower(v_student_id)
      AND status IN ('pending', 'approved')
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
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_student_registration_request(text, text, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_student_registration_request(text, text, text, text, text, boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_student_request(
  p_request_id       uuid,
  p_status           text,
  p_rejection_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id uuid;
  v_req public.student_registration_requests%ROWTYPE;
  v_inv_id uuid;
BEGIN
  v_admin_id := auth.uid();

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin_role_required' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_req
  FROM public.student_registration_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'request_already_reviewed' USING ERRCODE = '23505';
  END IF;

  UPDATE public.student_registration_requests
  SET
    status = p_status,
    reviewed_at = now(),
    reviewed_by = v_admin_id,
    rejection_reason = CASE WHEN p_status = 'rejected' THEN p_rejection_reason ELSE NULL END
  WHERE id = p_request_id;

  IF p_status = 'rejected' THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.staff_invitations (
    student_request_id,
    email,
    role,
    created_by
  )
  VALUES (
    v_req.id,
    v_req.email,
    'student'::public.app_role,
    v_admin_id
  )
  RETURNING id INTO v_inv_id;

  RETURN v_inv_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_review_student_request(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_review_student_request(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_student_invitation_by_token(p_token text)
RETURNS TABLE (
  id           uuid,
  email        text,
  full_name    text,
  student_id   text,
  course       text,
  year_level   text,
  is_irregular boolean,
  role         public.app_role,
  status       text,
  expires_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    i.id,
    i.email,
    r.full_name,
    r.student_id,
    r.course,
    r.year_level,
    r.is_irregular,
    i.role,
    i.status,
    i.expires_at
  FROM public.staff_invitations i
  JOIN public.student_registration_requests r ON r.id = i.student_request_id
  WHERE i.token = p_token
    AND i.role = 'student'::public.app_role
  LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_student_invitation_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_invitation_by_token(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.complete_student_invitation(
  p_token   text,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inv public.staff_invitations%ROWTYPE;
  v_req public.student_registration_requests%ROWTYPE;
  v_user_email text;
  v_year int;
BEGIN
  SELECT * INTO v_inv
  FROM public.staff_invitations
  WHERE token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.role <> 'student'::public.app_role THEN
    RAISE EXCEPTION 'invitation_role_not_allowed' USING ERRCODE = '42501';
  END IF;

  IF v_inv.status = 'accepted' THEN
    RAISE EXCEPTION 'invitation_already_accepted' USING ERRCODE = '23505';
  END IF;

  IF v_inv.status IN ('expired', 'revoked') THEN
    RAISE EXCEPTION 'invitation_not_valid' USING ERRCODE = '23514';
  END IF;

  IF v_inv.expires_at < now() THEN
    UPDATE public.staff_invitations SET status = 'expired' WHERE token = p_token;
    RAISE EXCEPTION 'invitation_expired' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_req
  FROM public.student_registration_requests
  WHERE id = v_inv.student_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT p.email INTO v_user_email
  FROM public.profiles p
  WHERE p.user_id = p_user_id
  LIMIT 1;

  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'user_profile_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF lower(trim(v_user_email)) <> lower(trim(v_inv.email)) THEN
    RAISE EXCEPTION 'email_mismatch' USING ERRCODE = '22023';
  END IF;

  -- The invitation, not signup metadata, decides the role and Student ID.
  DELETE FROM public.user_roles
  WHERE user_id = p_user_id
    AND role IS DISTINCT FROM 'student'::public.app_role;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (p_user_id, 'student'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  UPDATE public.profiles
  SET
    account_status = 'approved',
    student_id = v_req.student_id,
    full_name = COALESCE(NULLIF(trim(full_name), ''), v_req.full_name)
  WHERE user_id = p_user_id;

  v_year := CASE v_req.year_level
    WHEN '1st Year' THEN 1
    WHEN '2nd Year' THEN 2
    WHEN '3rd Year' THEN 3
    WHEN '4th Year' THEN 4
    ELSE 1
  END;

  INSERT INTO public.student_programs (student_id, program_id, year_level, is_irregular)
  SELECT p_user_id, prog.id, v_year, v_req.is_irregular OR v_req.year_level = 'Irregular'
  FROM public.programs prog
  WHERE prog.code = v_req.course
  ON CONFLICT (student_id) DO UPDATE SET
    program_id = EXCLUDED.program_id,
    year_level = EXCLUDED.year_level,
    is_irregular = EXCLUDED.is_irregular,
    updated_at = now();

  UPDATE public.staff_invitations
  SET status = 'accepted', accepted_at = now()
  WHERE token = p_token;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_student_invitation(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_student_invitation(text, uuid) TO anon, authenticated;
