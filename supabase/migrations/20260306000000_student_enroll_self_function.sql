-- Function so students can enroll themselves without relying on RLS INSERT policy.
-- Runs with definer rights; only allows enrolling auth.uid().
-- Parameter name "subject_id" so Supabase RPC finds it reliably.
DROP FUNCTION IF EXISTS public.enroll_self(uuid);

CREATE FUNCTION public.enroll_self(subject_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inserted boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  INSERT INTO public.enrollments (student_id, subject_id, status)
  VALUES (v_uid, enroll_self.subject_id, 'active')
  ON CONFLICT (student_id, subject_id) DO NOTHING
  RETURNING true INTO v_inserted;
  RETURN COALESCE(v_inserted, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.enroll_self(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enroll_self(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.enroll_self(uuid) TO service_role;
