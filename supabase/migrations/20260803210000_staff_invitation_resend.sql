-- Resend / re-issue a staff invitation.
-- Generates a fresh token, extends expiry by 7 days, and resets status
-- to 'pending'.  Can be called on expired, revoked, or pending invitations.
-- Accepted invitations cannot be re-issued.
--
-- Returns the updated invitation row (the caller needs the new token to
-- build the invitation URL for the email).

CREATE OR REPLACE FUNCTION public.resend_staff_invitation(p_invitation_id uuid)
RETURNS TABLE (
  id         uuid,
  email      text,
  department text,
  role       app_role,
  token      text,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_new_token text;
BEGIN
  v_admin_id := auth.uid();

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin_role_required' USING ERRCODE = '42501';
  END IF;

  -- Generate a new 64-char hex token.
  v_new_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  -- Update only if the invitation is not already accepted.
  UPDATE public.staff_invitations
  SET
    token      = v_new_token,
    status     = 'pending',
    expires_at = now() + interval '7 days',
    accepted_at = NULL
  WHERE id = p_invitation_id
    AND status <> 'accepted';

  IF NOT FOUND THEN
    -- Either the invitation doesn't exist or it was already accepted.
    RAISE EXCEPTION 'invitation_not_found_or_already_accepted' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT
    i.id, i.email, i.department, i.role, i.token, i.expires_at
  FROM public.staff_invitations i
  WHERE i.id = p_invitation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resend_staff_invitation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resend_staff_invitation(uuid) TO authenticated;
