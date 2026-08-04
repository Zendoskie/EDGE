-- Phase 5: allow admins to read student_programs for engagement analytics by program
DROP POLICY IF EXISTS "Admins can view all student program info" ON public.student_programs;
CREATE POLICY "Admins can view all student program info"
  ON public.student_programs FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));
