-- Existing parent accounts were not getting a durable inbox when the student rejected
-- a pending link request (email only). Registration-path rejections have no parent user.

CREATE OR REPLACE FUNCTION public.notify_parent_link_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_parent_name text;
  v_parent_email text;
  v_student_name text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(trim(p.full_name), ''), p.email), p.email
  INTO v_parent_name, v_parent_email
  FROM public.profiles p
  WHERE p.user_id = NEW.parent_user_id;

  SELECT COALESCE(NULLIF(trim(p.full_name), ''), p.email)
  INTO v_student_name
  FROM public.profiles p
  WHERE p.user_id = NEW.student_user_id;

  v_parent_name := COALESCE(v_parent_name, 'A parent/guardian');
  v_student_name := COALESCE(v_student_name, 'the student');

  IF NEW.status = 'pending' THEN
    INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
    VALUES (
      NEW.student_user_id,
      'Parent Access Request',
      format(
        '%s (%s) is requesting parent/guardian access to your academic records. Open Parent Access Requests to approve or reject.',
        v_parent_name,
        COALESCE(v_parent_email, 'no email')
      ),
      v_parent_name
    );

  ELSIF NEW.status = 'pending_admin' THEN
    INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
    SELECT
      ur.user_id,
      'Parent/Guardian request awaiting approval',
      format(
        '%s approved the parent/guardian request from %s (%s). Review it in Admin Approvals.',
        v_student_name,
        v_parent_name,
        COALESCE(v_parent_email, 'no email')
      ),
      v_student_name
    FROM public.user_roles ur
    WHERE ur.role = 'admin'::public.app_role;

  ELSIF NEW.status = 'approved' AND TG_OP = 'UPDATE' AND OLD.status = 'pending_admin' THEN
    INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
    VALUES
      (
        NEW.parent_user_id,
        'Parent/Guardian access approved',
        format('An administrator approved your access to %s''s academic records. Your parent account is now active.', v_student_name),
        'EDGE Administrator'
      ),
      (
        NEW.student_user_id,
        'Parent/Guardian access activated',
        format('An administrator approved %s''s access to your academic records.', v_parent_name),
        'EDGE Administrator'
      );

  ELSIF NEW.status = 'rejected' AND TG_OP = 'UPDATE' AND OLD.status IN ('pending', 'pending_admin') THEN
    INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
    VALUES (
      NEW.parent_user_id,
      'Access request rejected',
      format('%s rejected your request to access their academic information.', v_student_name),
      v_student_name
    );

  ELSIF NEW.status = 'admin_rejected' THEN
    INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
    VALUES
      (
        NEW.parent_user_id,
        'Parent/Guardian request rejected',
        format('An administrator did not approve your request to access %s''s academic records.', v_student_name),
        'EDGE Administrator'
      ),
      (
        NEW.student_user_id,
        'Parent/Guardian request rejected by administrator',
        format('An administrator rejected %s''s request to access your academic records.', v_parent_name),
        'EDGE Administrator'
      );
  END IF;

  RETURN NEW;
END;
$function$;
