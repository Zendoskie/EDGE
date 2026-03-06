-- Instructor subject isolation: each instructor sees and manages only their own subjects.
-- Students continue to see all subjects (for browsing/enrollment).

-- Drop existing broad policies
DROP POLICY IF EXISTS "Anyone authenticated can view subjects" ON public.subjects;
DROP POLICY IF EXISTS "Instructors can manage subjects" ON public.subjects;

-- Instructors: can only SELECT, INSERT, UPDATE, DELETE their own subjects
CREATE POLICY "Instructors can manage own subjects" ON public.subjects
  FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'instructor')
    AND instructor_id = auth.uid()
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'instructor')
    AND instructor_id = auth.uid()
  );

-- Students: can view all subjects (for enrollment browse and code lookup)
CREATE POLICY "Students can view subjects" ON public.subjects
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'student'));
