-- Harden engagement tracking: backfill, RPC access, student update policy.

UPDATE public.student_login_history
SET counts_as_login = true
WHERE counts_as_login IS NULL;

GRANT EXECUTE ON FUNCTION public.recompute_student_engagement(UUID) TO authenticated;

-- Students must be able to update open sessions (heartbeat + finalize).
DROP POLICY IF EXISTS "Students manage own login history" ON public.student_login_history;
CREATE POLICY "Students manage own login history" ON public.student_login_history
  FOR ALL USING (auth.uid() = student_id)
  WITH CHECK (auth.uid() = student_id);
