-- Let students see basic profile info for parents/guardians who requested linkage.

DROP POLICY IF EXISTS "Students can view linked parent profiles" ON public.profiles;
CREATE POLICY "Students can view linked parent profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.parent_student_links l
    WHERE l.student_user_id = auth.uid()
      AND l.parent_user_id = profiles.user_id
  )
);
