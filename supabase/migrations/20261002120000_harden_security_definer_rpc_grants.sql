-- Revoke anonymous EXECUTE on privileged SECURITY DEFINER RPCs.
-- Signup/staff-invitation RPCs keep anon access; everything else is authenticated
-- and/or service_role only. Functions still enforce role checks internally.

-- Admin / user-management (must never be callable without a signed-in session)
REVOKE EXECUTE ON FUNCTION public.admin_delete_user(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_account_status(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_review_staff_request(uuid, text, text) FROM anon;

-- Internal trigger helpers (not client RPCs)
REVOKE EXECUTE ON FUNCTION public.create_approval_inbox_notification() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_predictions_on_enrollment_delete() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_counseling_intervention_approval() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_login_history_update() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_role() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_parent_link_history() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_parent_link_status_change() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_engagement_alert_recipients(uuid, text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_account_status() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_feedback_engagement_activity() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_recompute_engagement() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_submission_engagement_activity() FROM anon, authenticated;

-- Engagement / prediction maintenance (authenticated staff flows only)
REVOKE EXECUTE ON FUNCTION public.create_engagement_alert(
  uuid, text, text, text, text, text, text, numeric, numeric, text, text
) FROM anon;
REVOKE EXECUTE ON FUNCTION public.evaluate_engagement_alerts(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_learning_recommendations(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recompute_student_engagement_internal(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.scan_engagement_inactivity_alerts() FROM anon;

-- RLS helper functions: authenticated only (used by policies, not public signup)
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.instructor_can_view_student(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.instructor_can_view_student_subject(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.instructor_owns_activity(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.instructor_owns_subject(uuid) FROM anon;

-- Parent link RPCs already revoked from anon in 20261002100100; reinforce.
REVOKE EXECUTE ON FUNCTION public.student_decide_parent_request(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_decide_parent_request(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.parent_request_student_link(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.parent_has_active_link(uuid) FROM anon;

-- Enrollment (students only, signed in)
REVOKE EXECUTE ON FUNCTION public.enroll_self(uuid) FROM anon;

-- Fix mutable search_path on thread stats trigger helper (logic unchanged)
CREATE OR REPLACE FUNCTION public.update_thread_stats()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.discussion_threads
    SET reply_count = reply_count + 1,
        last_reply_at = NEW.created_at
    WHERE id = NEW.thread_id;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.discussion_threads
    SET last_reply_at = NEW.updated_at
    WHERE id = NEW.thread_id;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$function$;
