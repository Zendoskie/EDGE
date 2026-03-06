-- Frontend uses anon key (role = anon) even when user is logged in.
-- Allow anon to insert/delete own enrollment when auth.uid() is set (JWT present).
CREATE POLICY "Students can insert own enrollment (anon)"
  ON public.enrollments FOR INSERT TO anon
  WITH CHECK (auth.uid() = student_id);

CREATE POLICY "Students can delete own enrollment (anon)"
  ON public.enrollments FOR DELETE TO anon
  USING (auth.uid() = student_id);
