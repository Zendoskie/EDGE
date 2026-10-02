-- Engagement recompute is staff-only; remove leftover anon grant.
REVOKE EXECUTE ON FUNCTION public.recompute_student_engagement(uuid) FROM anon;
