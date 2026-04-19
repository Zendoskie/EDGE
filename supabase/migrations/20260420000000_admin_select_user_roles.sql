-- Approval UI loads roles from public.user_roles for pending user_ids.
-- RLS previously only allowed SELECT where auth.uid() = user_id, so admins
-- could not see other users' roles and the app fell back to "student".

DROP POLICY IF EXISTS "Admins can view all user roles" ON public.user_roles;

CREATE POLICY "Admins can view all user roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));
