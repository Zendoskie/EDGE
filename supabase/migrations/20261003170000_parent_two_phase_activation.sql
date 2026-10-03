-- Parent/guardian signup follows student approval, then admin approval, then a
-- single-use invitation. The password is created only from that invitation.
-- A request waiting on the student is not visible to administrators.

CREATE TABLE IF NOT EXISTS public.parent_registration_requests (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name           text        NOT NULL,
  email               text        NOT NULL,
  student_id          text        NOT NULL,
  student_user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_name        text,
  status              text        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'rejected', 'pending_admin', 'admin_rejected', 'approved')),
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  student_decided_at  timestamptz,
  student_decided_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at         timestamptz,
  reviewed_by         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_parent_reg_requests_student
  ON public.parent_registration_requests (student_user_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_parent_reg_requests_status
  ON public.parent_registration_requests (status, submitted_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_parent_reg_requests_open_email
  ON public.parent_registration_requests (lower(email))
  WHERE status IN ('pending', 'pending_admin')
     OR (status = 'approved' AND completed_at IS NULL);

ALTER TABLE public.parent_registration_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students view own parent registration requests"
  ON public.parent_registration_requests;
CREATE POLICY "Students view own parent registration requests"
ON public.parent_registration_requests
FOR SELECT
TO authenticated
USING (student_user_id = auth.uid());

-- Administrators never receive a request the student has not approved.
DROP POLICY IF EXISTS "Admins view parent requests after student approval"
  ON public.parent_registration_requests;
CREATE POLICY "Admins view parent requests after student approval"
ON public.parent_registration_requests
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  AND status IN ('pending_admin', 'admin_rejected', 'approved')
);

DROP POLICY IF EXISTS "Admins can view all parent_student_links" ON public.parent_student_links;
DROP POLICY IF EXISTS "Admins view parent links after student approval" ON public.parent_student_links;
CREATE POLICY "Admins view parent links after student approval"
ON public.parent_student_links
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  AND status IN ('pending_admin', 'approved', 'admin_rejected')
);

ALTER TABLE public.staff_invitations
  ADD COLUMN IF NOT EXISTS parent_request_id uuid
  REFERENCES public.parent_registration_requests(id) ON DELETE SET NULL;

ALTER TABLE public.staff_invitations DROP CONSTRAINT IF EXISTS staff_invitations_role_check;
ALTER TABLE public.staff_invitations
  ADD CONSTRAINT staff_invitations_role_check
  CHECK (role IN ('instructor', 'guidance_counselor', 'student', 'parent'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_invitations_one_open_parent
  ON public.staff_invitations (parent_request_id)
  WHERE parent_request_id IS NOT NULL AND status = 'pending';

-- Phase 2 signup must not open a second student-approval request.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_guardian_student_id text;
  v_student_user_id uuid;
BEGIN
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'student');
  v_guardian_student_id := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'guardian_student_id', '')), '');

  INSERT INTO public.profiles (user_id, full_name, email, student_id, account_status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    CASE
      WHEN v_role = 'parent' THEN NULL
      ELSE NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'student_number', '')), '')
    END,
    'pending'
  );

  IF v_role = 'student' THEN
    BEGIN
      INSERT INTO public.student_programs (student_id, program_id, year_level, is_irregular)
      SELECT
        NEW.id,
        prog.id,
        CASE trim(COALESCE(NEW.raw_user_meta_data->>'year_level', ''))
          WHEN '1st Year' THEN 1
          WHEN '2nd Year' THEN 2
          WHEN '3rd Year' THEN 3
          WHEN '4th Year' THEN 4
          ELSE 1
        END,
        CASE lower(trim(COALESCE(NEW.raw_user_meta_data->>'is_irregular', '')))
          WHEN 'true' THEN true
          WHEN 't' THEN true
          WHEN '1' THEN true
          ELSE false
        END
      FROM public.programs prog
      WHERE NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'course', '')), '') IS NOT NULL
        AND prog.code = trim(NEW.raw_user_meta_data->>'course')
      ON CONFLICT (student_id) DO UPDATE SET
        program_id = EXCLUDED.program_id,
        year_level = EXCLUDED.year_level,
        is_irregular = EXCLUDED.is_irregular,
        updated_at = now();
    EXCEPTION
      WHEN undefined_table THEN
        NULL;
      WHEN undefined_column THEN
        NULL;
    END;
  ELSIF v_role = 'parent' THEN
    IF COALESCE(NEW.raw_user_meta_data->>'parent_invite', '') = '1' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'parent_invitation_required' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

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

CREATE OR REPLACE FUNCTION public.get_parent_invitation_by_token(p_token text)
RETURNS TABLE (
  id           uuid,
  email        text,
  full_name    text,
  student_id   text,
  student_name text,
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
    r.student_name,
    i.role,
    i.status,
    i.expires_at
  FROM public.staff_invitations i
  JOIN public.parent_registration_requests r ON r.id = i.parent_request_id
  WHERE i.token = p_token
    AND i.role = 'parent'::public.app_role
  LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_parent_invitation_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_parent_invitation_by_token(text) TO anon, authenticated;

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

CREATE OR REPLACE FUNCTION public.log_parent_link_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_stage boolean := NEW.status IN ('approved', 'admin_rejected') AND NEW.admin_decided_at IS NOT NULL;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.decided_at IS NOT DISTINCT FROM OLD.decided_at
     AND NEW.admin_decided_at IS NOT DISTINCT FROM OLD.admin_decided_at THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.parent_link_request_history (
    link_id,
    parent_user_id,
    student_user_id,
    status,
    requested_at,
    decided_at,
    decided_by,
    note
  )
  VALUES (
    NEW.id,
    NEW.parent_user_id,
    NEW.student_user_id,
    NEW.status,
    NEW.requested_at,
    CASE WHEN v_admin_stage THEN NEW.admin_decided_at ELSE NEW.decided_at END,
    CASE WHEN v_admin_stage THEN NEW.admin_decided_by ELSE NEW.decided_by END,
    CASE
      WHEN TG_OP = 'INSERT' AND NEW.status = 'approved' THEN 'Parent account activated from the approval invitation'
      WHEN TG_OP = 'INSERT' THEN 'Request created; awaiting student approval'
      WHEN NEW.status = 'pending' THEN 'Request re-submitted; awaiting student approval'
      WHEN NEW.status = 'pending_admin' THEN 'Approved by student; awaiting administrator approval'
      WHEN NEW.status = 'rejected' THEN 'Rejected by student'
      WHEN NEW.status = 'approved' THEN 'Approved by administrator; access active'
      WHEN NEW.status = 'admin_rejected' THEN 'Rejected by administrator'
      ELSE NULL
    END
  );
  RETURN NEW;
END;
$function$;
