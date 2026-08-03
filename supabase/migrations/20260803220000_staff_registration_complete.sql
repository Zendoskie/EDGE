-- Phase 6: Staff Registration completion functions.
--
-- 1. Extend get_staff_invitation_by_token to also return full_name
--    (sourced from the linked staff_registration_requests row).
--
-- 2. New RPC complete_staff_invitation(token, user_id):
--    Called by the client after supabase.auth.signUp() succeeds.
--    Validates the token, verifies the new user's email matches the
--    invitation email, marks the invitation accepted, and immediately
--    sets the profile account_status to 'approved' — bypassing the
--    normal admin-approval queue for invited staff.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Update get_staff_invitation_by_token to include full_name
--    DROP first because CREATE OR REPLACE cannot change the return type.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_staff_invitation_by_token(text);

CREATE OR REPLACE FUNCTION public.get_staff_invitation_by_token(p_token text)
RETURNS TABLE (
  id          uuid,
  email       text,
  full_name   text,
  department  text,
  role        app_role,
  status      text,
  expires_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    i.id,
    i.email,
    r.full_name,
    i.department,
    i.role,
    i.status,
    i.expires_at
  FROM public.staff_invitations i
  LEFT JOIN public.staff_registration_requests r ON r.id = i.request_id
  WHERE i.token = p_token
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_staff_invitation_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_staff_invitation_by_token(text) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. complete_staff_invitation
--
-- Security model:
--   • Callable by anon (user just signed up and was signed out).
--   • The token uniquely identifies the invitation.
--   • The user_id must belong to a profile whose email (case-insensitive)
--     matches the invitation email — this prevents token abuse where an
--     attacker uses a valid token against a different user account.
--   • Only valid (pending, non-expired) invitations are accepted.
-- ─────────────────────────────────────────────────────────────────────────────

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
  v_inv       public.staff_invitations%ROWTYPE;
  v_user_email text;
BEGIN
  -- 1. Lock and load the invitation.
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

  -- 2. Verify the newly-created user's email matches the invitation email.
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

  -- 3. Mark invitation accepted.
  UPDATE public.staff_invitations
  SET
    status      = 'accepted',
    accepted_at = now()
  WHERE token = p_token;

  -- 4. Immediately approve the profile — skips the admin-approval queue.
  UPDATE public.profiles
  SET account_status = 'approved'
  WHERE user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_staff_invitation(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_staff_invitation(text, uuid) TO anon, authenticated;
