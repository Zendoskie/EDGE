-- Allow students to enroll themselves (insert) and leave (delete) a course
CREATE POLICY "Students can insert own enrollment"
  ON public.enrollments FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = student_id);

CREATE POLICY "Students can delete own enrollment"
  ON public.enrollments FOR DELETE TO authenticated
  USING (auth.uid() = student_id);

-- Allow users to insert own profile (e.g. if trigger missed or for backfill)
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
