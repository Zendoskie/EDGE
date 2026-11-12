-- ID verification for parent, instructor, and guidance counselor registration.
--
-- 1. A private Storage bucket "id-documents" holds the front/back ID images.
-- 2. staff_registration_requests and parent_registration_requests gain id_front_path / id_back_path.
-- 3. Parent access gains a "pending_verification" state: the parent creates their password and
--    uploads their ID during CompleteParentRegistration, then an administrator verifies the ID
--    before the parent_student_link becomes active ("approved").

-- ---------------------------------------------------------------------------
-- 1. Storage bucket + policies
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('id-documents', 'id-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Applicants (staff are still unauthenticated; parents upload before finishing) may write their images.
DROP POLICY IF EXISTS "Anyone can upload id documents" ON storage.objects;
CREATE POLICY "Anyone can upload id documents"
ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (
  bucket_id = 'id-documents'
  AND (name LIKE 'staff/%' OR name LIKE 'parent/%')
);

-- Only administrators may read the submitted ID images.
DROP POLICY IF EXISTS "Admins can read id documents" ON storage.objects;
CREATE POLICY "Admins can read id documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'id-documents'
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

-- ---------------------------------------------------------------------------
-- 2. ID columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.staff_registration_requests
  ADD COLUMN IF NOT EXISTS id_front_path text,
  ADD COLUMN IF NOT EXISTS id_back_path  text;

ALTER TABLE public.parent_registration_requests
  ADD COLUMN IF NOT EXISTS id_front_path   text,
  ADD COLUMN IF NOT EXISTS id_back_path    text,
  ADD COLUMN IF NOT EXISTS id_verified_at  timestamptz,
  ADD COLUMN IF NOT EXISTS id_verified_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 3. parent_student_links status: allow "pending_verification"
-- ---------------------------------------------------------------------------

ALTER TABLE public.parent_student_links
  DROP CONSTRAINT IF EXISTS parent_student_links_status_check;
ALTER TABLE public.parent_student_links
  ADD CONSTRAINT parent_student_links_status_check
  CHECK (status IN ('pending', 'pending_admin', 'pending_verification', 'approved', 'rejected', 'admin_rejected'));

ALTER TABLE public.parent_link_request_history
  DROP CONSTRAINT IF EXISTS parent_link_request_history_status_check;
ALTER TABLE public.parent_link_request_history
  ADD CONSTRAINT parent_link_request_history_status_check
  CHECK (status IN ('pending', 'pending_admin', 'pending_verification', 'approved', 'rejected', 'admin_rejected'));

-- ---------------------------------------------------------------------------
-- 4. complete_parent_invitation: create the link as "pending_verification" and
--    store the uploaded ID paths so an administrator can verify them.
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
    id_front_path  = NULLIF(trim(COALESCE(p_id_front_path, '')), ''),
    id_back_path   = NULLIF(trim(COALESCE(p_id_back_path, '')), ''),
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

-- ---------------------------------------------------------------------------
-- 5. admin_verify_parent_id: verify (activate) or reject the parent's ID.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_verify_parent_id(
  p_request_id uuid,
  p_decision   text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_decision text := lower(trim(COALESCE(p_decision, '')));
  v_req public.parent_registration_requests%ROWTYPE;
  v_parent_name text;
  v_student_name text;
  v_link_id uuid;
BEGIN
  IF v_admin_id IS NULL OR NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_decision NOT IN ('verify', 'verified', 'approve', 'approved', 'reject', 'rejected') THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_req
  FROM public.parent_registration_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_req.completed_at IS NULL THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_req.parent_user_id IS NULL THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_decision IN ('reject', 'rejected') THEN
    UPDATE public.parent_student_links
    SET status = 'admin_rejected',
        admin_decided_at = now(),
        admin_decided_by = v_admin_id
    WHERE parent_user_id = v_req.parent_user_id
      AND student_user_id = v_req.student_user_id
      AND status = 'pending_verification'
    RETURNING id INTO v_link_id;

    UPDATE public.parent_registration_requests
    SET id_verified_at = NULL, id_verified_by = NULL
    WHERE id = p_request_id;

    RETURN;
  END IF;

  UPDATE public.parent_student_links
  SET status = 'approved',
      admin_decided_at = now(),
      admin_decided_by = v_admin_id
  WHERE parent_user_id = v_req.parent_user_id
    AND student_user_id = v_req.student_user_id
    AND status = 'pending_verification'
  RETURNING id INTO v_link_id;

  IF v_link_id IS NULL THEN
    RAISE EXCEPTION 'request_not_pending_verification' USING ERRCODE = '55000';
  END IF;

  UPDATE public.parent_registration_requests
  SET id_verified_at = now(), id_verified_by = v_admin_id
  WHERE id = p_request_id;

  SELECT COALESCE(NULLIF(trim(p.full_name), ''), p.email, 'A parent/guardian')
  INTO v_parent_name
  FROM public.profiles p
  WHERE p.user_id = v_req.parent_user_id;

  SELECT COALESCE(NULLIF(trim(p.full_name), ''), p.email, 'the student')
  INTO v_student_name
  FROM public.profiles p
  WHERE p.user_id = v_req.student_user_id;

  INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
  VALUES
    (
      v_req.parent_user_id,
      'ID verified — access activated',
      format('An administrator verified your ID. You can now view %s''s academic records.', v_student_name),
      'EDGE Administrator'
    ),
    (
      v_req.student_user_id,
      'Parent/Guardian access activated',
      format('An administrator verified %s''s ID and activated their access to your academic records.', v_parent_name),
      'EDGE Administrator'
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_verify_parent_id(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_verify_parent_id(uuid, text) TO authenticated;
