-- RUN THIS SECOND (separate Run in SQL Editor), after 01-add-admin-enum-value.sql succeeds.
-- Same body as migration 20260418000001_account_approval_profiles_functions_rls.sql

-- 1) Approval status on profiles (existing rows stay approved; new rows default pending)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_status text;

UPDATE public.profiles
SET account_status = 'approved'
WHERE account_status IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN account_status SET DEFAULT 'pending';

ALTER TABLE public.profiles
  ALTER COLUMN account_status SET NOT NULL;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_account_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_account_status_check
  CHECK (account_status IN ('pending', 'approved', 'rejected'));

-- 2) New users get pending approval; student_programs block is best-effort (never fails signup)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email, student_id, account_status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'student_number', '')), ''),
    'pending'
  );

  IF COALESCE(NEW.raw_user_meta_data->>'role', 'student') = 'student' THEN
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
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Admin RPC: approve / reject / pend (admin-only, SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.admin_set_account_status(p_target_user_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'approved', 'rejected') THEN
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

-- 4) RLS: admins can read all profiles (for approval queue)
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));
