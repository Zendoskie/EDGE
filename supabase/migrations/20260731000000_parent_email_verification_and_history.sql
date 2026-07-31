-- Parent Registration and Approval workflow:
-- 1) Store parent Gmail on student accounts during registration.
-- 2) Verify parent signup / re-request email matches the student's stored parent email.
-- 3) Maintain a request history/audit trail for every parent-student link transition.

-- 1) Parent email on profiles (nullable, backward compatible)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS parent_email text;

-- 2) Reworked handle_new_user: stores parent_email for students and verifies
--    the parent's signup email against the student's stored parent email.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_guardian_student_id text;
  v_parent_email text;
  v_student_user_id uuid;
  v_student_parent_email text;
BEGIN
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'student');
  v_guardian_student_id := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'guardian_student_id', '')), '');
  v_parent_email := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'parent_email', '')), '');

  INSERT INTO public.profiles (user_id, full_name, email, student_id, account_status, parent_email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'student_number', '')), ''),
    'pending',
    CASE WHEN v_role = 'student' THEN v_parent_email ELSE NULL END
  );

  IF v_role = 'student' THEN
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
  ELSIF v_role = 'parent' THEN
    IF v_guardian_student_id IS NULL THEN
      RAISE EXCEPTION 'guardian_student_id_required' USING ERRCODE = '22023';
    END IF;

    SELECT p.user_id, p.parent_email
    INTO v_student_user_id, v_student_parent_email
    FROM public.profiles p
    JOIN public.user_roles ur
      ON ur.user_id = p.user_id
     AND ur.role = 'student'::app_role
    WHERE p.student_id = v_guardian_student_id
    LIMIT 1;

    IF v_student_user_id IS NULL THEN
      RAISE EXCEPTION 'student_not_found_for_guardian_link' USING ERRCODE = 'P0002';
    END IF;

    -- Verify the parent's signup email matches the parent Gmail stored on the student's account.
    IF v_student_parent_email IS NULL OR trim(v_student_parent_email) = '' THEN
      RAISE EXCEPTION 'parent_email_not_set' USING ERRCODE = '22023';
    END IF;
    IF lower(trim(NEW.email)) <> lower(trim(v_student_parent_email)) THEN
      RAISE EXCEPTION 'parent_email_mismatch' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.parent_student_links (
      parent_user_id,
      student_user_id,
      student_id_no,
      status
    )
    VALUES (
      NEW.id,
      v_student_user_id,
      v_guardian_student_id,
      'pending'
    )
    ON CONFLICT (parent_user_id, student_user_id) DO UPDATE
    SET student_id_no = EXCLUDED.student_id_no,
        status = 'pending',
        requested_at = now(),
        decided_at = NULL,
        decided_by = NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Re-request RPC: also verify the parent's account email matches the student's stored parent email.
CREATE OR REPLACE FUNCTION public.parent_request_student_link(p_student_id_no text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_id uuid;
  v_student_id_no text;
  v_student_user_id uuid;
  v_student_parent_email text;
  v_parent_email text;
  v_link_id uuid;
  v_status text;
BEGIN
  v_parent_id := auth.uid();
  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.has_role(v_parent_id, 'parent'::app_role) THEN
    RAISE EXCEPTION 'parent_role_required' USING ERRCODE = '42501';
  END IF;

  v_student_id_no := NULLIF(trim(p_student_id_no), '');
  IF v_student_id_no IS NULL THEN
    RAISE EXCEPTION 'student_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT p.user_id, p.parent_email
  INTO v_student_user_id, v_student_parent_email
  FROM public.profiles p
  JOIN public.user_roles ur
    ON ur.user_id = p.user_id
   AND ur.role = 'student'::app_role
  WHERE p.student_id = v_student_id_no
  LIMIT 1;

  IF v_student_user_id IS NULL THEN
    RAISE EXCEPTION 'student_not_found_for_guardian_link' USING ERRCODE = 'P0002';
  END IF;

  IF v_parent_id = v_student_user_id THEN
    RAISE EXCEPTION 'invalid_parent_student_link' USING ERRCODE = '22023';
  END IF;

  SELECT email
  INTO v_parent_email
  FROM public.profiles
  WHERE user_id = v_parent_id
  LIMIT 1;

  -- Verify the parent's account email matches the parent Gmail stored on the student's account.
  IF v_student_parent_email IS NULL OR trim(v_student_parent_email) = '' THEN
    RAISE EXCEPTION 'parent_email_not_set' USING ERRCODE = '22023';
  END IF;
  IF v_parent_email IS NULL OR lower(trim(v_parent_email)) <> lower(trim(v_student_parent_email)) THEN
    RAISE EXCEPTION 'parent_email_mismatch' USING ERRCODE = '22023';
  END IF;

  SELECT l.id, l.status
  INTO v_link_id, v_status
  FROM public.parent_student_links l
  WHERE l.parent_user_id = v_parent_id
    AND l.student_user_id = v_student_user_id
  LIMIT 1;

  IF v_link_id IS NOT NULL THEN
    IF v_status = 'pending' THEN
      RAISE EXCEPTION 'pending_request_exists' USING ERRCODE = '23505';
    END IF;
    IF v_status = 'approved' THEN
      RAISE EXCEPTION 'already_approved' USING ERRCODE = '23505';
    END IF;
    IF v_status = 'rejected' THEN
      UPDATE public.parent_student_links
      SET
        status = 'pending',
        student_id_no = v_student_id_no,
        requested_at = now(),
        decided_at = NULL,
        decided_by = NULL
      WHERE id = v_link_id
        AND parent_user_id = v_parent_id;
      RETURN v_link_id;
    END IF;
  END IF;

  INSERT INTO public.parent_student_links (
    parent_user_id,
    student_user_id,
    student_id_no,
    status
  )
  VALUES (
    v_parent_id,
    v_student_user_id,
    v_student_id_no,
    'pending'
  )
  RETURNING id INTO v_link_id;

  RETURN v_link_id;
END;
$$;

REVOKE ALL ON FUNCTION public.parent_request_student_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parent_request_student_link(text) TO authenticated;

-- 4) Request history table (audit trail). Keeps one row per transition so
--    re-requests no longer overwrite the previous decision record.
CREATE TABLE IF NOT EXISTS public.parent_link_request_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.parent_student_links(id) ON DELETE CASCADE,
  parent_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES auth.users(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parent_link_request_history_link_idx
  ON public.parent_link_request_history (link_id);
CREATE INDEX IF NOT EXISTS parent_link_request_history_parent_idx
  ON public.parent_link_request_history (parent_user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS parent_link_request_history_student_idx
  ON public.parent_link_request_history (student_user_id, requested_at DESC);

ALTER TABLE public.parent_link_request_history ENABLE ROW LEVEL SECURITY;

-- Parents can view their own request history.
DROP POLICY IF EXISTS "Parents can view own request history" ON public.parent_link_request_history;
CREATE POLICY "Parents can view own request history"
ON public.parent_link_request_history
FOR SELECT
TO authenticated
USING (auth.uid() = parent_user_id);

-- Students can view their own request history.
DROP POLICY IF EXISTS "Students can view own request history" ON public.parent_link_request_history;
CREATE POLICY "Students can view own request history"
ON public.parent_link_request_history
FOR SELECT
TO authenticated
USING (auth.uid() = student_user_id);

-- Admin can view all history (approval queue / support).
DROP POLICY IF EXISTS "Admins can view request history" ON public.parent_link_request_history;
CREATE POLICY "Admins can view request history"
ON public.parent_link_request_history
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 5) Audit trigger: append a history row on insert and on status/decision changes.
CREATE OR REPLACE FUNCTION public.log_parent_link_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.parent_link_request_history (
    link_id,
    parent_user_id,
    student_user_id,
    status,
    requested_at,
    decided_at,
    decided_by,
    note
  )
  VALUES (
    NEW.id,
    NEW.parent_user_id,
    NEW.student_user_id,
    NEW.status,
    NEW.requested_at,
    NEW.decided_at,
    NEW.decided_by,
    CASE
      WHEN TG_OP = 'INSERT' THEN 'Request created'
      WHEN NEW.status = 'approved' THEN 'Request approved by student'
      WHEN NEW.status = 'rejected' THEN 'Request rejected by student'
      WHEN NEW.status = 'pending' THEN 'Request re-submitted'
      ELSE NULL
    END
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_parent_link_history ON public.parent_student_links;
CREATE TRIGGER trg_log_parent_link_history
AFTER INSERT OR UPDATE OF status, decided_at, decided_by
ON public.parent_student_links
FOR EACH ROW
EXECUTE FUNCTION public.log_parent_link_history();

-- Enable Realtime for the history table so history updates can refresh dashboards.
ALTER PUBLICATION supabase_realtime ADD TABLE public.parent_link_request_history;
