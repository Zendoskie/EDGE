-- Parent access requires the email the student registered, not a Student ID alone.
-- A mismatched request cannot be created, approved by the student, sent to an
-- administrator, invited, or activated. Reject remains available.

ALTER TABLE public.student_registration_requests
  ADD COLUMN IF NOT EXISTS parent_email text;

COMMENT ON COLUMN public.profiles.parent_email IS
  'Parent/guardian email the student registered. Parent access must match it.';

COMMENT ON COLUMN public.student_registration_requests.parent_email IS
  'Parent/guardian email captured at student signup and copied onto the student profile.';

-- ---------------------------------------------------------------------------
-- Shared server-side comparison. Does not return the stored email.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_registered_parent_email(
  p_student_user_id uuid,
  p_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_registered text;
  v_given text;
BEGIN
  v_given := lower(NULLIF(trim(p_email), ''));

  SELECT lower(NULLIF(trim(p.parent_email), ''))
  INTO v_registered
  FROM public.profiles p
  WHERE p.user_id = p_student_user_id;

  IF v_registered IS NULL THEN
    RAISE EXCEPTION 'parent_email_not_set' USING ERRCODE = '22023';
  END IF;

  IF v_given IS NULL OR v_given <> v_registered THEN
    RAISE EXCEPTION 'parent_email_mismatch' USING ERRCODE = '22023';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_registered_parent_email(uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The registered parent email is written only by account completion (or an admin).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_registered_parent_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.parent_email IS NOT DISTINCT FROM OLD.parent_email THEN
    RETURN NEW;
  END IF;

  IF current_setting('edge.allow_parent_email_write', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'parent_email_locked' USING ERRCODE = '42501';
END;
$function$;

REVOKE ALL ON FUNCTION public.protect_registered_parent_email() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_registered_parent_email ON public.profiles;
CREATE TRIGGER trg_protect_registered_parent_email
  BEFORE UPDATE OF parent_email ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_registered_parent_email();

-- ---------------------------------------------------------------------------
-- New student requests must store a parent email. Older rows stay completable.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_student_registration_parent_email()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_email text;
BEGIN
  v_email := lower(NULLIF(trim(NEW.parent_email), ''));

  IF TG_OP = 'INSERT' AND v_email IS NULL THEN
    RAISE EXCEPTION 'parent_email_required' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.parent_email IS NOT NULL
     AND v_email IS NULL THEN
    RAISE EXCEPTION 'parent_email_required' USING ERRCODE = '22023';
  END IF;

  IF v_email IS NOT NULL
     AND v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'parent_email_invalid' USING ERRCODE = '22023';
  END IF;

  IF v_email IS NOT NULL THEN
    NEW.parent_email := v_email;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_student_registration_parent_email() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_student_registration_parent_email ON public.student_registration_requests;
CREATE TRIGGER trg_enforce_student_registration_parent_email
  BEFORE INSERT OR UPDATE OF parent_email ON public.student_registration_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_student_registration_parent_email();

-- ---------------------------------------------------------------------------
-- Registration requests: mismatch cannot be inserted or moved forward.
-- Rejection stays allowed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_parent_registration_email_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IN ('rejected', 'admin_rejected') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
     OR (
       TG_OP = 'UPDATE'
       AND NEW.status IN ('pending', 'pending_admin', 'approved')
       AND NEW.status IS DISTINCT FROM OLD.status
     ) THEN
    PERFORM public.assert_registered_parent_email(NEW.student_user_id, NEW.email);
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_parent_registration_email_match() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_parent_registration_email_match ON public.parent_registration_requests;
CREATE TRIGGER trg_enforce_parent_registration_email_match
  BEFORE INSERT OR UPDATE OF status, email ON public.parent_registration_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_parent_registration_email_match();

-- ---------------------------------------------------------------------------
-- Existing-account links follow the same rule.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_parent_link_email_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_parent_email text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IN ('rejected', 'admin_rejected') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
     OR (
       TG_OP = 'UPDATE'
       AND NEW.status IN ('pending', 'pending_admin', 'approved')
       AND NEW.status IS DISTINCT FROM OLD.status
     ) THEN
    SELECT p.email
    INTO v_parent_email
    FROM public.profiles p
    WHERE p.user_id = NEW.parent_user_id;

    PERFORM public.assert_registered_parent_email(NEW.student_user_id, v_parent_email);
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_parent_link_email_match() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_parent_link_email_match ON public.parent_student_links;
CREATE TRIGGER trg_enforce_parent_link_email_match
  BEFORE INSERT OR UPDATE OF status ON public.parent_student_links
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_parent_link_email_match();

-- ---------------------------------------------------------------------------
-- Student signup stores the parent email. The previous 6-argument function
-- is removed so a request cannot be submitted without it.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.submit_student_registration_request(text, text, text, text, text, boolean);

CREATE OR REPLACE FUNCTION public.submit_student_registration_request(
  p_full_name    text,
  p_email        text,
  p_student_id   text,
  p_course       text,
  p_year_level   text,
  p_is_irregular boolean,
  p_parent_email text
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
  v_parent_email text;
  v_id uuid;
  v_submitted timestamptz;
  v_body text;
BEGIN
  v_name := NULLIF(trim(p_full_name), '');
  v_email := lower(NULLIF(trim(p_email), ''));
  v_student_id := NULLIF(trim(p_student_id), '');
  v_course := NULLIF(trim(p_course), '');
  v_year := NULLIF(trim(p_year_level), '');
  v_parent_email := lower(NULLIF(trim(p_parent_email), ''));

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'full_name_required' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'email_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_parent_email IS NULL THEN
    RAISE EXCEPTION 'parent_email_required' USING ERRCODE = '22023';
  END IF;
  IF v_parent_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'parent_email_invalid' USING ERRCODE = '22023';
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
    full_name, email, student_id, course, year_level, is_irregular, status, parent_email
  )
  VALUES (
    v_name, v_email, v_student_id, v_course, v_year, COALESCE(p_is_irregular, false), 'pending', v_parent_email
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

REVOKE ALL ON FUNCTION public.submit_student_registration_request(text, text, text, text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_student_registration_request(text, text, text, text, text, boolean, text) TO anon, authenticated;

-- Copy the registered parent email onto the student profile when the account activates.
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

  DELETE FROM public.user_roles
  WHERE user_id = p_user_id
    AND role IS DISTINCT FROM 'student'::public.app_role;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (p_user_id, 'student'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  PERFORM set_config('edge.allow_parent_email_write', '1', true);

  UPDATE public.profiles
  SET
    account_status = 'approved',
    student_id = v_req.student_id,
    full_name = COALESCE(NULLIF(trim(full_name), ''), v_req.full_name),
    parent_email = COALESCE(NULLIF(lower(trim(v_req.parent_email)), ''), parent_email)
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

-- ---------------------------------------------------------------------------
-- Parent signup: Student ID locates the student. The emails must match.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_parent_signup(p_student_id_no text, p_parent_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_student_id text;
  v_email text;
  v_student_user_id uuid;
BEGIN
  v_student_id := NULLIF(trim(p_student_id_no), '');
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'student_id_required' USING ERRCODE = '22023';
  END IF;

  v_email := lower(NULLIF(trim(p_parent_email), ''));
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'parent_email_required' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = v_email)
     OR EXISTS (SELECT 1 FROM public.profiles p WHERE lower(trim(p.email)) = v_email) THEN
    RAISE EXCEPTION 'parent_email_already_registered' USING ERRCODE = '23505';
  END IF;

  SELECT p.user_id
  INTO v_student_user_id
  FROM public.profiles p
  JOIN public.user_roles ur
    ON ur.user_id = p.user_id
   AND ur.role = 'student'::public.app_role
  WHERE lower(trim(p.student_id)) = lower(v_student_id)
  LIMIT 1;

  IF v_student_user_id IS NULL THEN
    RAISE EXCEPTION 'student_not_found_for_guardian_link' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.assert_registered_parent_email(v_student_user_id, v_email);
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_parent_signup(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_parent_signup(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_parent_registration_request(
  p_full_name text,
  p_email text,
  p_student_id text
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
  v_student_user_id uuid;
  v_student_name text;
  v_id uuid;
BEGIN
  v_name := NULLIF(trim(p_full_name), '');
  v_email := lower(NULLIF(trim(p_email), ''));
  v_student_id := NULLIF(trim(p_student_id), '');

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'full_name_required' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'email_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'student_id_required' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = v_email)
     OR EXISTS (SELECT 1 FROM public.profiles p WHERE lower(trim(p.email)) = v_email) THEN
    RAISE EXCEPTION 'parent_email_already_registered' USING ERRCODE = '23505';
  END IF;

  SELECT p.user_id, COALESCE(NULLIF(trim(p.full_name), ''), 'Student')
  INTO v_student_user_id, v_student_name
  FROM public.profiles p
  JOIN public.user_roles ur
    ON ur.user_id = p.user_id
   AND ur.role = 'student'::public.app_role
  WHERE lower(trim(p.student_id)) = lower(v_student_id)
    AND p.account_status = 'approved'
  LIMIT 1;

  IF v_student_user_id IS NULL THEN
    RAISE EXCEPTION 'student_not_found_for_guardian_link' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.assert_registered_parent_email(v_student_user_id, v_email);

  IF EXISTS (
    SELECT 1
    FROM public.parent_registration_requests r
    WHERE lower(r.email) = v_email
      AND (
        r.status IN ('pending', 'pending_admin')
        OR (r.status = 'approved' AND r.completed_at IS NULL)
      )
  ) THEN
    RAISE EXCEPTION 'pending_request_exists' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.parent_registration_requests r
    WHERE r.student_user_id = v_student_user_id
      AND lower(r.email) = v_email
      AND r.status = 'approved'
      AND r.completed_at IS NOT NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.parent_student_links l ON l.parent_user_id = p.user_id
    WHERE lower(trim(p.email)) = v_email
      AND l.student_user_id = v_student_user_id
      AND l.status = 'approved'
  ) THEN
    RAISE EXCEPTION 'already_approved' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.parent_registration_requests (
    full_name, email, student_id, student_user_id, student_name, status
  )
  VALUES (v_name, v_email, v_student_id, v_student_user_id, v_student_name, 'pending')
  RETURNING id INTO v_id;

  INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
  VALUES (
    v_student_user_id,
    'Parent Access Request',
    format(
      '%s (%s) is requesting parent/guardian access. Open Parent Access Requests to approve or reject.',
      v_name,
      v_email
    ),
    v_name
  );

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_parent_registration_request(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_parent_registration_request(text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.student_decide_parent_registration(
  p_request_id uuid,
  p_decision text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_decision text := lower(trim(COALESCE(p_decision, '')));
  v_req public.parent_registration_requests%ROWTYPE;
  v_new_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF v_decision IN ('approve', 'approved') THEN
    v_new_status := 'pending_admin';
  ELSIF v_decision IN ('reject', 'rejected') THEN
    v_new_status := 'rejected';
  ELSE
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_req
  FROM public.parent_registration_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_req.student_user_id <> v_uid THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'request_not_pending' USING ERRCODE = '55000';
  END IF;

  IF v_new_status = 'pending_admin' THEN
    PERFORM public.assert_registered_parent_email(v_req.student_user_id, v_req.email);
  END IF;

  UPDATE public.parent_registration_requests
  SET
    status = v_new_status,
    student_decided_at = now(),
    student_decided_by = v_uid
  WHERE id = p_request_id;

  IF v_new_status = 'pending_admin' THEN
    INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
    SELECT
      ur.user_id,
      'Parent/Guardian request awaiting approval',
      format(
        '%s approved the parent/guardian request from %s (%s). Review it in Admin Approvals.',
        COALESCE(v_req.student_name, 'The student'),
        v_req.full_name,
        v_req.email
      ),
      COALESCE(v_req.student_name, 'Student')
    FROM public.user_roles ur
    WHERE ur.role = 'admin'::public.app_role;
  END IF;

  RETURN v_new_status;
END;
$function$;

REVOKE ALL ON FUNCTION public.student_decide_parent_registration(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_decide_parent_registration(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_parent_request(
  p_request_id uuid,
  p_decision text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_decision text := lower(trim(COALESCE(p_decision, '')));
  v_req public.parent_registration_requests%ROWTYPE;
  v_inv_id uuid;
BEGIN
  IF v_admin_id IS NULL OR NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_decision NOT IN ('approve', 'approved', 'reject', 'rejected') THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_req
  FROM public.parent_registration_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_req.status <> 'pending_admin' THEN
    RAISE EXCEPTION 'request_not_awaiting_admin' USING ERRCODE = '55000';
  END IF;

  IF v_decision IN ('reject', 'rejected') THEN
    UPDATE public.parent_registration_requests
    SET status = 'admin_rejected', reviewed_at = now(), reviewed_by = v_admin_id
    WHERE id = p_request_id;
    RETURN NULL;
  END IF;

  PERFORM public.assert_registered_parent_email(v_req.student_user_id, v_req.email);

  IF EXISTS (
    SELECT 1
    FROM public.staff_invitations
    WHERE parent_request_id = v_req.id
      AND status = 'pending'
      AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'invitation_already_pending' USING ERRCODE = '23505';
  END IF;

  UPDATE public.parent_registration_requests
  SET status = 'approved', reviewed_at = now(), reviewed_by = v_admin_id
  WHERE id = p_request_id;

  INSERT INTO public.staff_invitations (
    parent_request_id,
    email,
    role,
    created_by
  )
  VALUES (
    v_req.id,
    v_req.email,
    'parent'::public.app_role,
    v_admin_id
  )
  RETURNING id INTO v_inv_id;

  RETURN v_inv_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_review_parent_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_parent_request(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_parent_invitation(
  p_token text,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inv public.staff_invitations%ROWTYPE;
  v_req public.parent_registration_requests%ROWTYPE;
  v_user_email text;
BEGIN
  SELECT * INTO v_inv
  FROM public.staff_invitations
  WHERE token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.role <> 'parent'::public.app_role THEN
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
  FROM public.parent_registration_requests
  WHERE id = v_inv.parent_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_req.status <> 'approved' THEN
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

  PERFORM public.assert_registered_parent_email(v_req.student_user_id, v_inv.email);

  DELETE FROM public.user_roles
  WHERE user_id = p_user_id
    AND role IS DISTINCT FROM 'parent'::public.app_role;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (p_user_id, 'parent'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  UPDATE public.profiles
  SET
    account_status = 'approved',
    full_name = COALESCE(NULLIF(trim(full_name), ''), v_req.full_name),
    updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.parent_student_links (
    parent_user_id,
    student_user_id,
    student_id_no,
    status,
    decided_at,
    decided_by,
    admin_decided_at,
    admin_decided_by
  )
  VALUES (
    p_user_id,
    v_req.student_user_id,
    v_req.student_id,
    'approved',
    v_req.student_decided_at,
    v_req.student_decided_by,
    v_req.reviewed_at,
    v_req.reviewed_by
  )
  ON CONFLICT (parent_user_id, student_user_id) DO UPDATE
  SET
    status = 'approved',
    student_id_no = EXCLUDED.student_id_no,
    decided_at = COALESCE(public.parent_student_links.decided_at, EXCLUDED.decided_at),
    decided_by = COALESCE(public.parent_student_links.decided_by, EXCLUDED.decided_by),
    admin_decided_at = now(),
    admin_decided_by = EXCLUDED.admin_decided_by;

  UPDATE public.parent_registration_requests
  SET completed_at = now()
  WHERE id = v_req.id;

  UPDATE public.staff_invitations
  SET status = 'accepted', accepted_at = now()
  WHERE token = p_token;

  INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
  VALUES (
    v_req.student_user_id,
    'Parent/Guardian access activated',
    format('%s can now view the academic records linked to your account.', v_req.full_name),
    v_req.full_name
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_parent_invitation(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_parent_invitation(text, uuid) TO anon, authenticated;

-- Additional links from an active parent account still require the email match.
CREATE OR REPLACE FUNCTION public.parent_request_student_link(p_student_id_no text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_parent_id uuid;
  v_student_id_no text;
  v_student_user_id uuid;
  v_parent_email text;
  v_link_id uuid;
  v_status text;
BEGIN
  v_parent_id := auth.uid();
  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.has_role(v_parent_id, 'parent'::app_role) THEN
    RAISE EXCEPTION 'parent_role_required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = v_parent_id AND account_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'account_not_active' USING ERRCODE = '42501';
  END IF;

  v_student_id_no := NULLIF(trim(p_student_id_no), '');
  IF v_student_id_no IS NULL THEN
    RAISE EXCEPTION 'student_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT p.user_id
  INTO v_student_user_id
  FROM public.profiles p
  JOIN public.user_roles ur
    ON ur.user_id = p.user_id
   AND ur.role = 'student'::app_role
  WHERE lower(trim(p.student_id)) = lower(v_student_id_no)
  LIMIT 1;

  IF v_student_user_id IS NULL THEN
    RAISE EXCEPTION 'student_not_found_for_guardian_link' USING ERRCODE = 'P0002';
  END IF;

  IF v_parent_id = v_student_user_id THEN
    RAISE EXCEPTION 'invalid_parent_student_link' USING ERRCODE = '22023';
  END IF;

  SELECT p.email
  INTO v_parent_email
  FROM public.profiles p
  WHERE p.user_id = v_parent_id;

  PERFORM public.assert_registered_parent_email(v_student_user_id, v_parent_email);

  SELECT l.id, l.status
  INTO v_link_id, v_status
  FROM public.parent_student_links l
  WHERE l.parent_user_id = v_parent_id
    AND l.student_user_id = v_student_user_id
  FOR UPDATE;

  IF v_link_id IS NOT NULL THEN
    IF v_status IN ('pending', 'pending_admin') THEN
      RAISE EXCEPTION 'pending_request_exists' USING ERRCODE = '23505';
    END IF;
    IF v_status = 'approved' THEN
      RAISE EXCEPTION 'already_approved' USING ERRCODE = '23505';
    END IF;

    UPDATE public.parent_student_links
    SET
      status = 'pending',
      student_id_no = v_student_id_no,
      requested_at = now(),
      decided_at = NULL,
      decided_by = NULL,
      admin_decided_at = NULL,
      admin_decided_by = NULL
    WHERE id = v_link_id;
    RETURN v_link_id;
  END IF;

  BEGIN
    INSERT INTO public.parent_student_links (parent_user_id, student_user_id, student_id_no, status)
    VALUES (v_parent_id, v_student_user_id, v_student_id_no, 'pending')
    RETURNING id INTO v_link_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'pending_request_exists' USING ERRCODE = '23505';
  END;

  RETURN v_link_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.student_decide_parent_request(p_link_id uuid, p_decision text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_decision text := lower(trim(COALESCE(p_decision, '')));
  v_new_status text;
  v_link public.parent_student_links%ROWTYPE;
  v_parent_email text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF v_decision IN ('approve', 'approved') THEN
    v_new_status := 'pending_admin';
  ELSIF v_decision IN ('reject', 'rejected') THEN
    v_new_status := 'rejected';
  ELSE
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_link
  FROM public.parent_student_links
  WHERE id = p_link_id
  FOR UPDATE;

  IF NOT FOUND OR v_link.student_user_id <> v_uid THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_link.status <> 'pending' THEN
    RAISE EXCEPTION 'request_not_pending' USING ERRCODE = '55000';
  END IF;

  IF v_new_status = 'pending_admin' THEN
    SELECT p.email INTO v_parent_email
    FROM public.profiles p
    WHERE p.user_id = v_link.parent_user_id;
    PERFORM public.assert_registered_parent_email(v_link.student_user_id, v_parent_email);
  END IF;

  UPDATE public.parent_student_links
  SET status = v_new_status, decided_at = now(), decided_by = v_uid
  WHERE id = p_link_id;

  RETURN v_new_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_decide_parent_request(p_link_id uuid, p_decision text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_decision text := lower(trim(COALESCE(p_decision, '')));
  v_link public.parent_student_links%ROWTYPE;
  v_parent_email text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_decision NOT IN ('approve', 'approved', 'reject', 'rejected') THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_link
  FROM public.parent_student_links
  WHERE id = p_link_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_link.status <> 'pending_admin' THEN
    RAISE EXCEPTION 'request_not_awaiting_admin' USING ERRCODE = '55000';
  END IF;

  IF v_decision IN ('approve', 'approved') THEN
    SELECT p.email INTO v_parent_email
    FROM public.profiles p
    WHERE p.user_id = v_link.parent_user_id;
    PERFORM public.assert_registered_parent_email(v_link.student_user_id, v_parent_email);

    UPDATE public.parent_student_links
    SET status = 'approved', admin_decided_at = now(), admin_decided_by = v_uid
    WHERE id = p_link_id;

    UPDATE public.profiles
    SET account_status = 'approved', updated_at = now()
    WHERE user_id = v_link.parent_user_id
      AND account_status IN ('pending', 'rejected');

    RETURN 'approved';
  END IF;

  UPDATE public.parent_student_links
  SET status = 'admin_rejected', admin_decided_at = now(), admin_decided_by = v_uid
  WHERE id = p_link_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.parent_student_links
    WHERE parent_user_id = v_link.parent_user_id
      AND status = 'approved'
  ) THEN
    UPDATE public.profiles
    SET account_status = 'rejected', updated_at = now()
    WHERE user_id = v_link.parent_user_id
      AND account_status = 'pending';
  END IF;

  RETURN 'admin_rejected';
END;
$function$;

REVOKE ALL ON FUNCTION public.student_decide_parent_request(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_decide_parent_request(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parent_request_student_link(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_decide_parent_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_decide_parent_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parent_request_student_link(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
