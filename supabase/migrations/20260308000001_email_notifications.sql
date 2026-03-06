-- Track notification emails to avoid spamming students

CREATE TABLE IF NOT EXISTS public.email_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE CASCADE,
  risk_level TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_notifications_student_subject_idx
  ON public.email_notifications (student_id, subject_id, sent_at DESC);

ALTER TABLE public.email_notifications ENABLE ROW LEVEL SECURITY;

-- Students can view their own notification history
DROP POLICY IF EXISTS "Students can view own email notifications" ON public.email_notifications;
CREATE POLICY "Students can view own email notifications"
  ON public.email_notifications
  FOR SELECT
  USING (auth.uid() = student_id);

-- Instructors can manage notification records (needed for sending in edge function)
DROP POLICY IF EXISTS "Instructors can manage email notifications" ON public.email_notifications;
CREATE POLICY "Instructors can manage email notifications"
  ON public.email_notifications
  FOR ALL
  USING (public.has_role(auth.uid(), 'instructor'));

