-- Phase 7: User Management
-- 1. Extend account_status to include 'deactivated'
-- 2. Update admin_set_account_status to allow 'deactivated'
-- 3. Add admin_delete_user function (hard delete via auth schema)

-- ── 1. Extend CHECK constraint ─────────────────────────────────────────────────
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_account_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_account_status_check
  CHECK (account_status IN ('pending', 'approved', 'rejected', 'deactivated'));

-- ── 2. Update admin_set_account_status to accept 'deactivated' ─────────────────
CREATE OR REPLACE FUNCTION public.admin_set_account_status(
  p_target_user_id uuid,
  p_status         text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'approved', 'rejected', 'deactivated') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;
  UPDATE public.profiles
  SET account_status = p_status, updated_at = now()
  WHERE user_id = p_target_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_account_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_account_status(uuid, text) TO authenticated;

-- ── 3. admin_delete_user: hard-delete from auth.users ─────────────────────────
-- Cascades to profiles, user_roles, and all child tables via FK ON DELETE CASCADE.
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id     uuid;
  v_is_admin      boolean;
BEGIN
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.has_role(v_caller_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_role_required' USING ERRCODE = '42501';
  END IF;

  IF p_target_user_id = v_caller_id THEN
    RAISE EXCEPTION 'cannot_delete_self' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_target_user_id AND role = 'admin'::public.app_role
  ) INTO v_is_admin;

  IF v_is_admin THEN
    RAISE EXCEPTION 'cannot_delete_admin' USING ERRCODE = '42501';
  END IF;

  DELETE FROM auth.users WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;

-- ── 4. Admin can read user_roles for all users (for User Management) ───────────
DROP POLICY IF EXISTS "Admins can view all user_roles" ON public.user_roles;
CREATE POLICY "Admins can view all user_roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ── 5. Admin can read student_engagement_summary (for last login / stats) ──────
DROP POLICY IF EXISTS "Admins can view all engagement summaries" ON public.student_engagement_summary;
CREATE POLICY "Admins can view all engagement summaries"
ON public.student_engagement_summary
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ── 6. Admin can read parent_student_links ─────────────────────────────────────
DROP POLICY IF EXISTS "Admins can view all parent_student_links" ON public.parent_student_links;
CREATE POLICY "Admins can view all parent_student_links"
ON public.parent_student_links
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ── 7. Admin can read subjects (for instructor profile view) ───────────────────
DROP POLICY IF EXISTS "Admins can view all subjects" ON public.subjects;
CREATE POLICY "Admins can view all subjects"
ON public.subjects
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));
