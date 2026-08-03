-- Helper RPC callable by anon so the public staff-request form can validate
-- duplicate submissions without exposing the full table via SELECT.
--
-- Returns:
--   has_pending_request  – true if a pending request already exists for this email
--   email_is_registered  – true if this email already has a profile (i.e. an account)

CREATE OR REPLACE FUNCTION public.check_staff_request_status(p_email text)
RETURNS TABLE (
  has_pending_request  boolean,
  email_is_registered  boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    EXISTS(
      SELECT 1
      FROM public.staff_registration_requests
      WHERE lower(email) = lower(trim(p_email))
        AND status = 'pending'
    ) AS has_pending_request,
    EXISTS(
      SELECT 1
      FROM public.profiles
      WHERE lower(email) = lower(trim(p_email))
    ) AS email_is_registered;
END;
$$;

REVOKE ALL ON FUNCTION public.check_staff_request_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_staff_request_status(text) TO anon, authenticated;
