-- Add durable notification attribution and keep guidance engagement student-only.

ALTER TABLE public.user_inbox_notifications
  ADD COLUMN IF NOT EXISTS source_name text;

UPDATE public.user_inbox_notifications
SET source_name = 'EDGE System'
WHERE source_name IS NULL OR trim(source_name) = '';

CREATE OR REPLACE FUNCTION public.set_inbox_notification_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_is_staff boolean := false;
BEGIN
  IF NEW.source_name IS NOT NULL AND trim(NEW.source_name) <> '' THEN
    NEW.source_name := trim(NEW.source_name);
    RETURN NEW;
  END IF;

  IF v_actor_id IS NOT NULL THEN
    v_is_staff :=
      public.has_role(v_actor_id, 'instructor'::public.app_role)
      OR public.has_role(v_actor_id, 'guidance_counselor'::public.app_role)
      OR public.has_role(v_actor_id, 'admin'::public.app_role);
  END IF;

  IF v_is_staff THEN
    SELECT COALESCE(NULLIF(trim(profile.full_name), ''), NULLIF(trim(profile.email), ''))
    INTO v_actor_name
    FROM public.profiles profile
    WHERE profile.user_id = v_actor_id
    LIMIT 1;
  END IF;

  NEW.source_name := COALESCE(v_actor_name, 'EDGE System');
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_inbox_notification_source()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS set_inbox_notification_source
  ON public.user_inbox_notifications;
CREATE TRIGGER set_inbox_notification_source
BEFORE INSERT ON public.user_inbox_notifications
FOR EACH ROW
EXECUTE FUNCTION public.set_inbox_notification_source();

ALTER TABLE public.user_inbox_notifications
  ALTER COLUMN source_name SET NOT NULL;

DROP POLICY IF EXISTS "Guidance counselors view engagement summaries"
  ON public.student_engagement_summary;
CREATE POLICY "Guidance counselors view engagement summaries"
  ON public.student_engagement_summary
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'guidance_counselor'::public.app_role)
    AND public.has_role(student_id, 'student'::public.app_role)
  );

DROP POLICY IF EXISTS "Guidance counselors view student profiles"
  ON public.profiles;
CREATE POLICY "Guidance counselors view student profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'guidance_counselor'::public.app_role)
    AND public.has_role(profiles.user_id, 'student'::public.app_role)
  );
