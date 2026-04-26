-- Add parent role support and student-approved parent/guardian links.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_enum e
    JOIN pg_catalog.pg_type t ON t.oid = e.enumtypid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'app_role' AND e.enumlabel = 'parent'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'parent';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.parent_student_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id_no text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES auth.users(id),
  UNIQUE (parent_user_id, student_user_id)
);

ALTER TABLE public.parent_student_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Parents can insert own link requests" ON public.parent_student_links;
CREATE POLICY "Parents can insert own link requests"
ON public.parent_student_links
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = parent_user_id
  AND status = 'pending'
  AND parent_user_id <> student_user_id
);

DROP POLICY IF EXISTS "Parents can view own link requests" ON public.parent_student_links;
CREATE POLICY "Parents can view own link requests"
ON public.parent_student_links
FOR SELECT
TO authenticated
USING (auth.uid() = parent_user_id);

DROP POLICY IF EXISTS "Students can view parent requests" ON public.parent_student_links;
CREATE POLICY "Students can view parent requests"
ON public.parent_student_links
FOR SELECT
TO authenticated
USING (auth.uid() = student_user_id);

DROP POLICY IF EXISTS "Students can decide parent requests" ON public.parent_student_links;
CREATE POLICY "Students can decide parent requests"
ON public.parent_student_links
FOR UPDATE
TO authenticated
USING (auth.uid() = student_user_id)
WITH CHECK (
  auth.uid() = student_user_id
  AND status IN ('approved', 'rejected')
  AND decided_by = auth.uid()
  AND decided_at IS NOT NULL
);

-- Allow parent users to read linked student records once approved by the student.
DROP POLICY IF EXISTS "Parents can view approved student profiles" ON public.profiles;
CREATE POLICY "Parents can view approved student profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.parent_student_links l
    WHERE l.parent_user_id = auth.uid()
      AND l.student_user_id = profiles.user_id
      AND l.status = 'approved'
  )
);

DROP POLICY IF EXISTS "Parents can view approved student enrollments" ON public.enrollments;
CREATE POLICY "Parents can view approved student enrollments"
ON public.enrollments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.parent_student_links l
    WHERE l.parent_user_id = auth.uid()
      AND l.student_user_id = enrollments.student_id
      AND l.status = 'approved'
  )
);

DROP POLICY IF EXISTS "Parents can view approved student attendance" ON public.attendance;
CREATE POLICY "Parents can view approved student attendance"
ON public.attendance
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.parent_student_links l
    WHERE l.parent_user_id = auth.uid()
      AND l.student_user_id = attendance.student_id
      AND l.status = 'approved'
  )
);

DROP POLICY IF EXISTS "Parents can view approved student submissions" ON public.submissions;
CREATE POLICY "Parents can view approved student submissions"
ON public.submissions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.parent_student_links l
    WHERE l.parent_user_id = auth.uid()
      AND l.student_user_id = submissions.student_id
      AND l.status = 'approved'
  )
);

DROP POLICY IF EXISTS "Parents can view approved student predictions" ON public.predictions;
CREATE POLICY "Parents can view approved student predictions"
ON public.predictions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.parent_student_links l
    WHERE l.parent_user_id = auth.uid()
      AND l.student_user_id = predictions.student_id
      AND l.status = 'approved'
  )
);

DROP POLICY IF EXISTS "Parents can view approved student interventions" ON public.interventions;
CREATE POLICY "Parents can view approved student interventions"
ON public.interventions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.parent_student_links l
    WHERE l.parent_user_id = auth.uid()
      AND l.student_user_id = interventions.student_id
      AND l.status = 'approved'
  )
);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_guardian_student_id text;
  v_student_user_id uuid;
BEGIN
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'student');
  v_guardian_student_id := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'guardian_student_id', '')), '');

  INSERT INTO public.profiles (user_id, full_name, email, student_id, account_status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'student_number', '')), ''),
    'pending'
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

    SELECT p.user_id
    INTO v_student_user_id
    FROM public.profiles p
    JOIN public.user_roles ur
      ON ur.user_id = p.user_id
     AND ur.role = 'student'::app_role
    WHERE p.student_id = v_guardian_student_id
    LIMIT 1;

    IF v_student_user_id IS NULL THEN
      RAISE EXCEPTION 'student_not_found_for_guardian_link' USING ERRCODE = 'P0002';
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
