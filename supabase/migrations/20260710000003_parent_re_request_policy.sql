-- Allow parents to re-request access after rejection by resetting link status to pending.
DROP POLICY IF EXISTS "Parents can re-request rejected links" ON public.parent_student_links;
CREATE POLICY "Parents can re-request rejected links"
ON public.parent_student_links
FOR UPDATE
TO authenticated
USING (
  auth.uid() = parent_user_id
  AND status = 'rejected'
)
WITH CHECK (
  auth.uid() = parent_user_id
  AND status = 'pending'
  AND decided_at IS NULL
  AND decided_by IS NULL
);
