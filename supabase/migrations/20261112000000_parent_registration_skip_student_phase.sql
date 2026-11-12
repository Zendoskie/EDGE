-- Parent registration bypasses student approval because the student already approved
-- the parent email at signup time (profiles.parent_email). The submit RPC already
-- enforces this via assert_registered_parent_email (raises 22023 on mismatch).
-- This migration:
-- 1. Changes submit_parent_registration_request to create the request at 'pending_admin'
--    (not 'pending') and notifies admins directly at submit time.
-- 2. Keeps assert_registered_parent_email unchanged — it remains the gate.
-- 3. Keeps student_decide_parent_registration intact for any legacy 'pending' rows.
-- 4. complete_parent_invitation still creates the link at 'pending_verification'
--    (ID check required), then admin_verify_parent_id promotes to 'approved'.
-- 5. parent_student_links.decided_at/decided_by stay NULL for bypass-originated rows
--    (the student's earlier email registration is the "first phase" approval).

-- ---------------------------------------------------------------------------
-- 1. submit_parent_registration_request: insert at 'pending_admin' + notify admins
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.submit_parent_registration_request(text, text, text, text, text);

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

  -- Enforce the parent email the student registered at signup.
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

  -- Create request directly at 'pending_admin' — student approval is implicit
  -- because the parent email matches profiles.parent_email set at student signup.
  INSERT INTO public.parent_registration_requests (
    full_name, email, student_id, student_user_id, student_name,
    status, id_front_path, id_back_path
  )
  VALUES (
    v_name, v_email, v_student_id, v_student_user_id, v_student_name,
    'pending_admin', v_front, v_back
  )
  RETURNING id INTO v_id;

  -- Notify administrators (not the student) — the request is now awaiting admin review.
  INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
  SELECT
    ur.user_id,
    'Parent/Guardian request awaiting approval',
    format(
      '%s (%s) requested parent/guardian access for %s. The parent email matches the student''s registered email. Review in Admin Approvals.',
      v_name,
      v_email,
      v_student_name
    ),
    v_name
  FROM public.user_roles ur
  WHERE ur.role = 'admin'::public.app_role;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_parent_registration_request(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_parent_registration_request(text, text, text, text, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. student_decide_parent_registration: keep for legacy 'pending' rows
--    (no logic change; still only works when status = 'pending').
-- ---------------------------------------------------------------------------
-- No change needed — the existing function only processes status = 'pending'.
-- Bypass-originated rows are created at 'pending_admin' and skip this step.

-- ---------------------------------------------------------------------------
-- 3. Admin UI: ParentGuardianRequestsCard already handles 'pending_admin' rows
--    (View ID + Approve/Reject). The 'Student approved' badge/copy is stale
--    and will be updated in the frontend files.
-- ---------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';