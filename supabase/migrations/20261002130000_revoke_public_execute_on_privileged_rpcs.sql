-- PostgreSQL grants EXECUTE to PUBLIC by default; anon inherits PUBLIC.
-- Revoke PUBLIC on privileged SECURITY DEFINER functions, then re-grant only
-- to roles that should call them. Signup / staff-invitation RPCs keep anon.

-- Internal trigger helpers (not client-callable)
REVOKE ALL ON FUNCTION public.create_approval_inbox_notification() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_predictions_on_enrollment_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_counseling_intervention_approval() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_login_history_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_parent_link_history() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_parent_link_status_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_engagement_alert_recipients(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_account_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trigger_feedback_engagement_activity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trigger_recompute_engagement() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trigger_submission_engagement_activity() FROM PUBLIC;

-- Admin (authenticated; role checks inside function body)
REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_set_account_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_account_status(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_review_staff_request(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_review_staff_request(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_decide_parent_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_decide_parent_request(uuid, text) TO authenticated;

-- Engagement / prediction (authenticated staff flows)
REVOKE ALL ON FUNCTION public.create_engagement_alert(
  uuid, text, text, text, text, text, text, numeric, numeric, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_engagement_alert(
  uuid, text, text, text, text, text, text, numeric, numeric, text, text
) TO authenticated;
REVOKE ALL ON FUNCTION public.evaluate_engagement_alerts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_engagement_alerts(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.generate_learning_recommendations(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_learning_recommendations(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.recompute_student_engagement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_student_engagement(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.recompute_student_engagement_internal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.scan_engagement_inactivity_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scan_engagement_inactivity_alerts() TO authenticated;
REVOKE ALL ON FUNCTION public.complete_engagement_intervention(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_engagement_intervention(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.log_engagement_intervention(
  uuid, text, text, uuid, jsonb, boolean, uuid, uuid, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_engagement_intervention(
  uuid, text, text, uuid, jsonb, boolean, uuid, uuid, timestamptz
) TO authenticated;

-- RLS helpers (authenticated only; used by policies)
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
REVOKE ALL ON FUNCTION public.instructor_can_view_student(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.instructor_can_view_student(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.instructor_can_view_student_subject(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.instructor_can_view_student_subject(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.instructor_owns_activity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.instructor_owns_activity(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.instructor_owns_subject(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.instructor_owns_subject(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.parent_has_active_link(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parent_has_active_link(uuid) TO authenticated;

-- Parent link (authenticated)
REVOKE ALL ON FUNCTION public.student_decide_parent_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_decide_parent_request(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.parent_request_student_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parent_request_student_link(text) TO authenticated;

-- Enrollment (authenticated students)
REVOKE ALL ON FUNCTION public.enroll_self(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enroll_self(uuid) TO authenticated;

-- Signup / staff-invitation RPCs: explicit anon + authenticated (no PUBLIC)
REVOKE ALL ON FUNCTION public.validate_student_signup(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_student_signup(text, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_parent_signup(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_parent_signup(text, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.check_staff_request_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_staff_request_status(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_staff_invitation_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_staff_invitation_by_token(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_staff_invitation(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_staff_invitation(text, uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_staff_invitation_accepted(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_staff_invitation_accepted(text) TO anon, authenticated;
