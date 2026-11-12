-- Parent ID verification moves to the first registration step (the Login signup
-- form). The initial submit_parent_registration_request now accepts and stores
-- the front/back ID paths, and complete_parent_invitation preserves whatever
-- was already stored instead of requiring a fresh upload at completion.
--
-- This keeps the "pending_verification" state intact: the parent uploads their
-- ID when requesting access, then an administrator verifies it before the
-- parent_student_link becomes active.

-- ---------------------------------------------------------------------------
-- submit_parent_registration_request: accept + store ID paths.
-- ---------------------------------------------------------------------------

-- Drop the old 3-parameter version first to avoid overload ambiguity
DROP FUNCTION IF EXISTS public.submit_parent_registration_request(text, text, text);

CREATE OR REPLACE FUNCTION public.submit_parent_registration_request(
  p_full_name    text,
  p_email        text,
  p_student_id   text,
  p_id_front_path text DEFAULT NULL,
  p_id_back_path  text DEFAULT NULL
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
  v_front text;
  v_back text;
  v_id uuid;
BEGIN
  v_name := NULLIF(trim(p_full_name), '');
  v_email := lower(NULLIF(trim(p_email), ''));
  v_student_id := NULLIF(trim(p_student_id), '');
  v_front := NULLIF(trim(COALESCE(p_id_front_path, '')), '');
  v_back := NULLIF(trim(COALESCE(p_id_back_path, '')), '');

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'full_name_required' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'email_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'student_id_required' USING ERRCODE = '22023';
  END IF;

  -- ID images must be stored under the private parent/ prefix, and both sides
  -- must be present together.
  IF (v_front IS NULL) <> (v_back IS NULL) THEN
    RAISE EXCEPTION 'id_paths_incomplete' USING ERRCODE = '22023';
  END IF;
  IF v_front IS NOT NULL
     AND (left(v_front, 7) <> 'parent/' OR left(v_back, 7) <> 'parent/') THEN
    RAISE EXCEPTION 'invalid_id_path' USING ERRCODE = '22023';
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
    full_name, email, student_id, student_user_id, student_name,
    status, id_front_path, id_back_path
  )
  VALUES (
    v_name, v_email, v_student_id, v_student_user_id, v_student_name,
    'pending', v_front, v_back
  )
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

REVOKE ALL ON FUNCTION public.submit_parent_registration_request(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_parent_registration_request(text, text, text, text, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- complete_parent_invitation: keep already-stored ID paths when the client no
-- longer re-uploads at completion. The parent now uploads at step one.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.complete_parent_invitation(text, uuid);

CREATE OR REPLACE FUNCTION public.complete_parent_invitation(
  p_token          text,
  p_user_id        uuid,
  p_id_front_path  text DEFAULT NULL,
  p_id_back_path   text DEFAULT NULL
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
  v_student_name text;
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
    decided_by
  )
  VALUES (
    p_user_id,
    v_req.student_user_id,
    v_req.student_id,
    'pending_verification',
    v_req.student_decided_at,
    v_req.student_decided_by
  )
  ON CONFLICT (parent_user_id, student_user_id) DO UPDATE
  SET
    status = 'pending_verification',
    student_id_no = EXCLUDED.student_id_no,
    decided_at = COALESCE(public.parent_student_links.decided_at, EXCLUDED.decided_at),
    decided_by = COALESCE(public.parent_student_links.decided_by, EXCLUDED.decided_by),
    admin_decided_at = NULL,
    admin_decided_by = NULL;

  UPDATE public.parent_registration_requests
  SET
    completed_at   = now(),
    parent_user_id = p_user_id,
    -- Keep the paths uploaded at the first step; only overwrite when the
    -- client explicitly supplies fresh ones at completion.
    id_front_path  = COALESCE(NULLIF(trim(COALESCE(p_id_front_path, '')), ''), v_req.id_front_path),
    id_back_path   = COALESCE(NULLIF(trim(COALESCE(p_id_back_path, '')), ''), v_req.id_back_path),
    id_verified_at = NULL,
    id_verified_by = NULL
  WHERE id = v_req.id;

  UPDATE public.staff_invitations
  SET status = 'accepted', accepted_at = now()
  WHERE token = p_token;

  SELECT COALESCE(NULLIF(trim(p.full_name), ''), p.email, 'the student')
  INTO v_student_name
  FROM public.profiles p
  WHERE p.user_id = v_req.student_user_id;

  -- Parent: account created; access stays blocked until an administrator verifies the ID.
  INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
  VALUES (
    p_user_id,
    'ID verification pending',
    format(
      'Your parent account is set up. An administrator must verify your ID before you can view %s''s academic records.',
      v_student_name
    ),
    'EDGE Administrator'
  );

  -- Student: keep them informed.
  INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
  VALUES (
    v_req.student_user_id,
    'Parent/Guardian ID awaiting verification',
    format('%s completed registration and submitted an ID. An administrator will verify it.', v_req.full_name),
    v_req.full_name
  );

  -- Administrators: surface the verification task in their durable inbox.
  INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
  SELECT
    ur.user_id,
    'Parent/Guardian ID awaiting verification',
    format('%s (%s) finished registration and submitted an ID. Verify it in Admin Approvals.', v_req.full_name, v_inv.email),
    v_req.full_name
  FROM public.user_roles ur
  WHERE ur.role = 'admin'::public.app_role;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_parent_invitation(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_parent_invitation(text, uuid, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
