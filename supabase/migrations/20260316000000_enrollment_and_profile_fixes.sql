-- =============================================================================
-- Enrollment & profile fixes: make enrollment RLS app-driven and sync profiles
-- Run this after existing migrations. Safe to run multiple times (idempotent).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) ENROLLMENT POLICIES
-- Remove all existing student enrollment insert/delete policies so the app
-- controls program restrictions (MySubjects.tsx). RLS only enforces "own row".
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Students can insert own enrollment (anon)" ON public.enrollments;
DROP POLICY IF EXISTS "Students can insert own enrollment" ON public.enrollments;
DROP POLICY IF EXISTS "Students can insert own enrollment with restrictions" ON public.enrollments;

CREATE POLICY "Students can insert own enrollment"
  ON public.enrollments FOR INSERT
  TO anon, authenticated
  WITH CHECK (auth.uid() = student_id);

DROP POLICY IF EXISTS "Students can delete own enrollment (anon)" ON public.enrollments;
DROP POLICY IF EXISTS "Students can delete own enrollment" ON public.enrollments;

CREATE POLICY "Students can delete own enrollment"
  ON public.enrollments FOR DELETE
  TO anon, authenticated
  USING (auth.uid() = student_id);

-- -----------------------------------------------------------------------------
-- 2) BACKFILL profiles.student_id FROM AUTH METADATA
-- Syncs student_number from auth.users.raw_user_meta_data into profiles.student_id.
-- Idempotent: only updates when profile.student_id is null or empty.
-- -----------------------------------------------------------------------------
UPDATE public.profiles p
SET student_id = NULLIF(TRIM(u.raw_user_meta_data->>'student_number'), '')
FROM auth.users u
WHERE p.user_id = u.id
  AND (p.student_id IS NULL OR TRIM(COALESCE(p.student_id, '')) = '')
  AND COALESCE(TRIM(u.raw_user_meta_data->>'student_number'), '') <> '';

-- -----------------------------------------------------------------------------
-- 3) INDEX FOR INSTRUCTOR / ENROLLMENT QUERIES
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_enrollments_subject_status
  ON public.enrollments (subject_id, status);

-- -----------------------------------------------------------------------------
-- 4) STUDENT_PROGRAMS TABLE (only if missing)
-- Ensures table exists with expected columns. Later migrations add is_irregular;
-- we do not alter here to avoid conflicts. Run only on fresh DBs if needed.
-- -----------------------------------------------------------------------------
-- Table and RLS already created in 20260311000000 and 20260311000001.
-- No change needed unless you are setting up from scratch without those.

-- =============================================================================
-- VERIFICATION QUERIES (run manually in SQL editor to confirm data)
-- =============================================================================
/*
-- Enrollments with status and subject info:
SELECT e.id, e.student_id, p.full_name AS student_name, p.email AS student_email,
       s.code AS subject_code, s.name AS subject_name, e.status, e.enrolled_at
FROM public.enrollments e
JOIN public.profiles p ON p.user_id = e.student_id
JOIN public.subjects s ON s.id = e.subject_id
ORDER BY e.enrolled_at DESC;

-- Student–program mappings:
SELECT sp.id, sp.student_id, prof.full_name, prof.email, prog.code AS program_code,
       sp.year_level, sp.is_irregular, sp.created_at
FROM public.student_programs sp
JOIN public.profiles prof ON prof.user_id = sp.student_id
LEFT JOIN public.programs prog ON prog.id = sp.program_id
ORDER BY prog.code NULLS LAST, prof.full_name;

-- Required programs (ensure these exist):
SELECT code, name FROM public.programs WHERE code IN ('BSCS','BSBA','BEED','BSED') ORDER BY code;

-- Link a student to a program (edit email and program code, then run):
-- INSERT INTO public.student_programs (student_id, program_id)
-- SELECT u.id, prog.id
-- FROM auth.users u
-- JOIN public.programs prog ON prog.code = 'BSCS'
-- WHERE u.email = 'student-email@example.com'
-- ON CONFLICT (student_id) DO UPDATE SET program_id = EXCLUDED.program_id;
*/
