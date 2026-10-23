-- Registration completion inserts parent_student_links as approved directly, so the
-- pending_admin → approved UPDATE trigger never notifies the parent. Add the same
-- durable inbox row here (student notice already inserted in this RPC).

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

  SELECT COALESCE(NULLIF(trim(p.full_name), ''), p.email, 'the student')
  INTO v_student_name
  FROM public.profiles p
  WHERE p.user_id = v_req.student_user_id;

  INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
  VALUES (
    p_user_id,
    'Parent/Guardian access approved',
    format(
      'An administrator approved your access to %s''s academic records. Your parent account is now active.',
      v_student_name
    ),
    'EDGE Administrator'
  );

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
