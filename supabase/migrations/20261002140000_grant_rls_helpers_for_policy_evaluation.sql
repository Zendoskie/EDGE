-- RLS policies on student_login_history (and other tables) call has_role()
-- and instructor_can_view_student() for every reader, including students.
-- Those checks run as the PostgREST session role (authenticator, then anon or
-- authenticated). Revoking PUBLIC execute made anon/authenticator fail the
-- policy expression with "permission denied for function has_role" instead of
-- returning false. Students only need the functions to evaluate to false for
-- roles they do not hold; the functions stay SECURITY DEFINER and do not
-- expose row data.

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon, authenticator;
GRANT EXECUTE ON FUNCTION public.instructor_can_view_student(uuid) TO anon, authenticator;
GRANT EXECUTE ON FUNCTION public.instructor_can_view_student_subject(uuid, uuid) TO anon, authenticator;
GRANT EXECUTE ON FUNCTION public.instructor_owns_activity(uuid) TO anon, authenticator;
GRANT EXECUTE ON FUNCTION public.instructor_owns_subject(uuid) TO anon, authenticator;
GRANT EXECUTE ON FUNCTION public.parent_has_active_link(uuid) TO anon, authenticator;
