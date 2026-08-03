-- Fix resend_staff_invitation: change from SECURITY DEFINER to SECURITY INVOKER.
--
-- Root cause: the original function ran as the `postgres` owner role
-- (SECURITY DEFINER). Supabase RLS UPDATE policies on staff_invitations are
-- scoped TO authenticated, which does NOT apply to the postgres role. As a
-- result postgres saw zero rows to update → IF NOT FOUND raised P0002 →
-- PostgREST returned HTTP 400.
--
-- SECURITY INVOKER means the function executes as the calling admin user.
-- That user satisfies the "Admins can manage staff invitations" UPDATE policy,
-- so the UPDATE succeeds and the function returns the refreshed row.

DROP FUNCTION IF EXISTS public.resend_staff_invitation(uuid);

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
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_new_token text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin_role_required' USING ERRCODE = '42501';
  END IF;

  v_new_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  UPDATE public.staff_invitations
  SET
    token       = v_new_token,
    status      = 'pending',
    expires_at  = now() + interval '7 days',
    accepted_at = NULL
  WHERE id = p_invitation_id
    AND status <> 'accepted';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_not_found_or_already_accepted' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT i.id, i.email, i.department, i.role, i.token, i.expires_at
  FROM public.staff_invitations i
  WHERE i.id = p_invitation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resend_staff_invitation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resend_staff_invitation(uuid) TO authenticated;
