-- Secure parent access request / re-request by student ID (bypasses profile lookup RLS safely).
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

  SELECT p.user_id
  INTO v_student_user_id
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
