-- =============================================================================
-- Allow anon role to INSERT into student_programs (frontend uses anon key + JWT)
-- Without this, "Complete profile" save from the browser never creates a row,
-- so enrollment later sees no row and shows "complete your profile first".
-- =============================================================================

DROP POLICY IF EXISTS "Users can insert own program info (anon)" ON public.student_programs;
CREATE POLICY "Users can insert own program info (anon)"
  ON public.student_programs FOR INSERT
  TO anon
  WITH CHECK (auth.uid() = student_id);
