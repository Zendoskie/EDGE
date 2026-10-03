-- Staff accounts become active only through a single-use invitation.
-- The invitation role replaces whatever role the signup metadata claimed.
-- Admins cannot mark an instructor or counselor approved until that
-- invitation has been accepted. Students and parents are unchanged.

CREATE OR REPLACE FUNCTION public.complete_staff_invitation(
  p_token   text,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv        public.staff_invitations%ROWTYPE;
  v_user_email text;
BEGIN
  SELECT * INTO v_inv
  FROM public.staff_invitations
  WHERE token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_not_found' USING ERRCODE = 'P0002';
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

  IF v_inv.role NOT IN ('instructor'::public.app_role, 'guidance_counselor'::public.app_role) THEN
    RAISE EXCEPTION 'invitation_role_not_allowed' USING ERRCODE = '42501';
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
    AND role IS DISTINCT FROM v_inv.role;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (p_user_id, v_inv.role)
  ON CONFLICT (user_id, role) DO NOTHING;

  UPDATE public.staff_invitations
  SET
    status      = 'accepted',
    accepted_at = now()
  WHERE token = p_token;

  UPDATE public.profiles
  SET account_status = 'approved'
  WHERE user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_account_status(p_target_user_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'approved', 'rejected', 'deactivated') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'approved'
     AND public.has_role(p_target_user_id, 'parent'::app_role)
     AND NOT EXISTS (
       SELECT 1 FROM public.parent_student_links
       WHERE parent_user_id = p_target_user_id
         AND status = 'approved'
     ) THEN
    RAISE EXCEPTION 'parent_requires_verified_link' USING ERRCODE = '42501';
  END IF;
  IF p_status = 'approved'
     AND (
       public.has_role(p_target_user_id, 'instructor'::public.app_role)
       OR public.has_role(p_target_user_id, 'guidance_counselor'::public.app_role)
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.staff_invitations i
       JOIN public.profiles p ON lower(trim(p.email)) = lower(trim(i.email))
       WHERE p.user_id = p_target_user_id
         AND i.status = 'accepted'
         AND (
           (public.has_role(p_target_user_id, 'instructor'::public.app_role) AND i.role = 'instructor'::public.app_role)
           OR (public.has_role(p_target_user_id, 'guidance_counselor'::public.app_role) AND i.role = 'guidance_counselor'::public.app_role)
         )
     ) THEN
    RAISE EXCEPTION 'staff_requires_invitation' USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles
  SET account_status = p_status, updated_at = now()
  WHERE user_id = p_target_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;
