-- Phase 3A: attendance session defaults.
--
-- 1. Refuse to continue if any (student, subject, date) group has conflicting statuses.
-- 2. Remove exact duplicates (same status), keeping the earliest row.
-- 3. Enforce one attendance row per student, subject and calendar day (adviser-confirmed:
--    a subject meets at most once per day).
-- 4. record_attendance(): the only client write path. The first mark of a session date
--    defaults every eligible active student to Present; later calls change only the
--    clicked student's row, and only when the status differs.
--
-- Historical rows are not backfilled or rewritten. The attendance percentage convention is
-- unchanged: (present + late) / recorded rows, with excused counted in the denominator only.

-- Block concurrent writes between the duplicate check and the constraint.
LOCK TABLE public.attendance IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  v_conflicts int;
BEGIN
  SELECT count(*) INTO v_conflicts
  FROM (
    SELECT 1
    FROM public.attendance
    WHERE student_id IS NOT NULL AND subject_id IS NOT NULL
    GROUP BY student_id, subject_id, date
    HAVING count(DISTINCT status) > 1
  ) c;

  IF v_conflicts > 0 THEN
    RAISE EXCEPTION 'attendance_conflicting_duplicates: % (student, subject, date) group(s) have different statuses; resolve them manually before applying this migration', v_conflicts;
  END IF;
END
$$;

-- Rows with a NULL student_id or subject_id are left alone: the unique constraint treats NULLs as distinct.
DELETE FROM public.attendance a
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY student_id, subject_id, date
           ORDER BY created_at ASC NULLS LAST, id ASC
         ) AS rn
  FROM public.attendance
  WHERE student_id IS NOT NULL AND subject_id IS NOT NULL
) d
WHERE a.id = d.id
  AND d.rn > 1;

ALTER TABLE public.attendance
  ADD CONSTRAINT attendance_student_subject_date_key UNIQUE (student_id, subject_id, date);

-- Enrollment eligibility for a session date uses the Asia/Manila calendar date of enrolled_at.
-- An enrollment with a NULL enrolled_at has an unknown start date, so it is never treated as
-- enrolled on the requested date: it gets no default row and cannot receive a new row here.
-- An existing row for an actively enrolled student can still be corrected.
CREATE OR REPLACE FUNCTION public.record_attendance(
  p_subject_id uuid,
  p_date date,
  p_student_id uuid,
  p_status text
)
RETURNS SETOF public.attendance
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_enrolled_at timestamptz;
  v_has_row boolean;
BEGIN
  IF p_subject_id IS NULL OR p_date IS NULL OR p_student_id IS NULL THEN
    RAISE EXCEPTION 'Subject, date and student are required.';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('present', 'absent', 'late', 'excused') THEN
    RAISE EXCEPTION 'Invalid attendance status.';
  END IF;

  IF p_date > v_today THEN
    RAISE EXCEPTION 'Attendance cannot be recorded for a future date.';
  END IF;

  -- Same predicate as the attendance RLS policy, checked first for a clear error.
  -- RLS still enforces ownership on every read and write below.
  IF v_uid IS NULL
     OR NOT public.has_role(v_uid, 'instructor'::public.app_role)
     OR NOT public.instructor_owns_subject(p_subject_id) THEN
    RAISE EXCEPTION 'Not allowed to record attendance for this subject.';
  END IF;

  SELECT e.enrolled_at INTO v_enrolled_at
  FROM public.enrollments e
  WHERE e.subject_id = p_subject_id
    AND e.student_id = p_student_id
    AND e.status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student is not actively enrolled in this subject.';
  END IF;

  IF v_enrolled_at IS NULL OR (v_enrolled_at AT TIME ZONE 'Asia/Manila')::date > p_date THEN
    SELECT EXISTS (
      SELECT 1 FROM public.attendance a
      WHERE a.subject_id = p_subject_id AND a.student_id = p_student_id AND a.date = p_date
    ) INTO v_has_row;
    IF NOT v_has_row THEN
      IF v_enrolled_at IS NULL THEN
        RAISE EXCEPTION 'Student enrollment date is unknown; attendance cannot be created for this date.';
      END IF;
      RAISE EXCEPTION 'Student was not yet enrolled on this date.';
    END IF;
  END IF;

  -- One request per subject and session date at a time, held until commit or rollback. Two concurrent
  -- first marks for different students would otherwise insert the defaults and their own student in
  -- opposite order and deadlock (40P01). Taken after the checks above, so refused calls never wait,
  -- and before the check below, which then sees any roster a previous holder committed. The date is
  -- a day number (DateStyle-independent); a subject-hash collision only makes two subjects' marks on
  -- the same date wait for each other.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('record_attendance:' || p_subject_id::text),
    p_date - DATE '2000-01-01'
  );

  -- First mark of this session date: default every other eligible active student to Present.
  IF NOT EXISTS (
    SELECT 1 FROM public.attendance a
    WHERE a.subject_id = p_subject_id AND a.date = p_date
  ) THEN
    INSERT INTO public.attendance (student_id, subject_id, date, status, recorded_by)
    SELECT e.student_id, p_subject_id, p_date, 'present', v_uid
    FROM public.enrollments e
    WHERE e.subject_id = p_subject_id
      AND e.status = 'active'
      AND e.student_id IS NOT NULL
      AND e.student_id <> p_student_id
      AND e.enrolled_at IS NOT NULL
      AND (e.enrolled_at AT TIME ZONE 'Asia/Manila')::date <= p_date
    ON CONFLICT (student_id, subject_id, date) DO NOTHING;
  END IF;

  INSERT INTO public.attendance AS a (student_id, subject_id, date, status, recorded_by)
  VALUES (p_student_id, p_subject_id, p_date, p_status, v_uid)
  ON CONFLICT (student_id, subject_id, date) DO UPDATE
    SET status = EXCLUDED.status,
        recorded_by = EXCLUDED.recorded_by
    WHERE a.status IS DISTINCT FROM EXCLUDED.status;

  RETURN QUERY
    SELECT a.*
    FROM public.attendance a
    WHERE a.subject_id = p_subject_id AND a.date = p_date;
END;
$$;

REVOKE ALL ON FUNCTION public.record_attendance(uuid, date, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_attendance(uuid, date, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.record_attendance(uuid, date, uuid, text) IS
  'Instructor attendance write path. First mark of a date defaults eligible active students (enrolled on or before the Asia/Manila date, enrolled_at not null) to present without overwriting; later calls change only the clicked student when the status differs. Returns the date''s rows. SECURITY INVOKER: attendance RLS applies.';
