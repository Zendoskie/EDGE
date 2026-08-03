-- Record every parent invitation email sent so the system can audit
-- and display whether an invitation has been dispatched.
CREATE TABLE IF NOT EXISTS public.parent_invitation_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_user_id uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_email    text        NOT NULL,
  student_name    text,
  student_id_no   text,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  triggered_by    text        NOT NULL DEFAULT 'registration'
                              CHECK (triggered_by IN ('registration', 'resend'))
);

ALTER TABLE public.parent_invitation_log ENABLE ROW LEVEL SECURITY;

-- Students can read their own invitation log entries.
CREATE POLICY "students_read_own_invitation_log"
  ON public.parent_invitation_log
  FOR SELECT
  USING (student_user_id = auth.uid());
