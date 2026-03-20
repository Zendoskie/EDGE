-- Enforce one student ID per student profile (runs after 20260320000099 dedupe).
CREATE UNIQUE INDEX IF NOT EXISTS profiles_student_id_unique
  ON public.profiles (student_id)
  WHERE student_id IS NOT NULL AND btrim(student_id) <> '';
