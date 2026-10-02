-- Brings the repository in line with auth hardening that already exists on the
-- live project. Both definitions are identical to production; re-running is safe.

CREATE OR REPLACE FUNCTION public.protect_account_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin boolean;
BEGIN
  IF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
    -- System-level operations (SQL console as owner, service role, edge functions
    -- using service_role) run with auth.uid() = NULL and must be allowed.
    IF auth.uid() IS NULL THEN
      RETURN NEW;
    END IF;
    v_is_admin := public.has_role(auth.uid(), 'admin'::public.app_role);
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'account_status_change_forbidden'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_protect_account_status ON public.profiles;
CREATE TRIGGER trg_protect_account_status
  BEFORE UPDATE OF account_status ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_account_status();

CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_claimed_role text;
  v_role public.app_role;
BEGIN
  v_claimed_role := lower(trim(COALESCE(NEW.raw_user_meta_data->>'role', 'student')));

  -- 'admin' is never self-service: it can only be granted by an administrator.
  IF v_claimed_role NOT IN ('student', 'parent', 'instructor', 'guidance_counselor') THEN
    v_role := 'student'::public.app_role;
  ELSE
    v_role := v_claimed_role::public.app_role;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, v_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$function$;
