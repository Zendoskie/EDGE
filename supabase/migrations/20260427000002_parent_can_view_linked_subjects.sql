-- Allow parents to view subject rows for their approved linked students.

DROP POLICY IF EXISTS "Parents can view linked student subjects" ON public.subjects;
CREATE POLICY "Parents can view linked student subjects"
ON public.subjects
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.parent_student_links l
    JOIN public.enrollments e
      ON e.student_id = l.student_user_id
     AND e.subject_id = subjects.id
    WHERE l.parent_user_id = auth.uid()
      AND l.status = 'approved'
  )
);
