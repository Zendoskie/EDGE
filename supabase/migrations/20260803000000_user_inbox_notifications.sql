-- Persistent in-app notification inbox for account approval / rejection events.
-- Approved instructors and guidance counselors see these on their first login.
-- Rejected applicants cannot log in, so they are notified via email only.

CREATE TABLE IF NOT EXISTS public.user_inbox_notifications (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      text        NOT NULL,
  body       text        NOT NULL,
  read       boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_inbox_notifications_user_read_idx
  ON public.user_inbox_notifications (user_id, read, created_at DESC);

ALTER TABLE public.user_inbox_notifications ENABLE ROW LEVEL SECURITY;

-- Users can read their own notifications.
DROP POLICY IF EXISTS "Users can read own inbox notifications" ON public.user_inbox_notifications;
CREATE POLICY "Users can read own inbox notifications"
ON public.user_inbox_notifications
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

-- Users can mark their own notifications as read (only allowed to flip read to true).
DROP POLICY IF EXISTS "Users can mark own notifications read" ON public.user_inbox_notifications;
CREATE POLICY "Users can mark own notifications read"
ON public.user_inbox_notifications
FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id AND read = true);

-- ---------------------------------------------------------------------------
-- Trigger: insert an inbox notification when an instructor or guidance
-- counselor account transitions from pending → approved.
-- Rejected applicants are notified via email; they cannot log in to see a
-- dashboard notification.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_approval_inbox_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  IF OLD.account_status IS NOT DISTINCT FROM NEW.account_status THEN
    RETURN NEW;
  END IF;

  IF NEW.account_status <> 'approved' THEN
    RETURN NEW;
  END IF;

  -- Only notify instructor and guidance_counselor roles.
  SELECT ur.role::text INTO v_role
  FROM public.user_roles ur
  WHERE ur.user_id = NEW.user_id
    AND ur.role IN ('instructor'::app_role, 'guidance_counselor'::app_role)
  LIMIT 1;

  IF v_role IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_inbox_notifications (user_id, title, body)
  VALUES (
    NEW.user_id,
    'Account Approved',
    'Your account registration has been approved by the administrator. Welcome to EDGE! You can now sign in and access your dashboard.'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_approval_inbox_notification ON public.profiles;
CREATE TRIGGER trg_create_approval_inbox_notification
AFTER UPDATE OF account_status
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.create_approval_inbox_notification();
