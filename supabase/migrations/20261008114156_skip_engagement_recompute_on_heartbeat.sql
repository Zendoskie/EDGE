-- A session heartbeat only advances session_duration. That update was
-- recomputing engagement, writing student_engagement_summary, and waking
-- the dashboard, which recomputed again. Login, logout, and other
-- engagement inputs still recompute.

CREATE OR REPLACE FUNCTION public.trigger_recompute_engagement_on_login_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.student_id IS NOT DISTINCT FROM OLD.student_id
     AND NEW.login_time IS NOT DISTINCT FROM OLD.login_time
     AND NEW.logout_time IS NOT DISTINCT FROM OLD.logout_time
     AND NEW.counts_as_login IS NOT DISTINCT FROM OLD.counts_as_login THEN
    RETURN NEW;
  END IF;

  PERFORM public.recompute_student_engagement_internal(
    COALESCE(NEW.student_id, OLD.student_id)
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_recompute_engagement_on_login_history() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS student_login_history_recompute_engagement ON public.student_login_history;
CREATE TRIGGER student_login_history_recompute_engagement
  AFTER INSERT OR UPDATE ON public.student_login_history
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_recompute_engagement_on_login_history();
