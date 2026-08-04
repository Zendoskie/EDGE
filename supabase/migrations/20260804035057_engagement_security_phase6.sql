-- Phase 6: Engagement module RLS hardening
-- Students: own data only
-- Instructors: assigned class students only (instructor_can_view_student)
-- Guidance counselors: read-only campus-wide
-- Admins: full access

-- ── Views: enforce underlying table RLS ──────────────────────────────────────
CREATE OR REPLACE VIEW public.student_login_logs
WITH (security_invoker = true) AS
SELECT *
FROM public.student_login_history;

CREATE OR REPLACE VIEW public.student_activity_logs
WITH (security_invoker = true) AS
SELECT *
FROM public.student_activity;

GRANT SELECT ON public.student_login_logs TO authenticated;
GRANT SELECT ON public.student_activity_logs TO authenticated;

-- Guidance counselors need student names for the read-only engagement roster.
DROP POLICY IF EXISTS "Guidance counselors view student profiles" ON public.profiles;
CREATE POLICY "Guidance counselors view student profiles"
  ON public.profiles FOR SELECT
  USING (
    public.has_role(auth.uid(), 'guidance_counselor'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = profiles.user_id
        AND ur.role = 'student'::app_role
    )
  );

-- ── student_login_history ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Guidance counselors view login history" ON public.student_login_history;
CREATE POLICY "Guidance counselors view login history"
  ON public.student_login_history FOR SELECT
  USING (public.has_role(auth.uid(), 'guidance_counselor'::app_role));

DROP POLICY IF EXISTS "Admins manage login history" ON public.student_login_history;
CREATE POLICY "Admins manage login history"
  ON public.student_login_history FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- ── student_activity ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Guidance counselors view student activity" ON public.student_activity;
CREATE POLICY "Guidance counselors view student activity"
  ON public.student_activity FOR SELECT
  USING (public.has_role(auth.uid(), 'guidance_counselor'::app_role));

DROP POLICY IF EXISTS "Admins manage student activity" ON public.student_activity;
CREATE POLICY "Admins manage student activity"
  ON public.student_activity FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- ── student_engagement_summary ───────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can view all engagement summaries" ON public.student_engagement_summary;
DROP POLICY IF EXISTS "Admins view all engagement summaries" ON public.student_engagement_summary;
DROP POLICY IF EXISTS "Admins manage engagement summaries" ON public.student_engagement_summary;
CREATE POLICY "Admins manage engagement summaries"
  ON public.student_engagement_summary FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Guidance counselors view engagement summaries" ON public.student_engagement_summary;
CREATE POLICY "Guidance counselors view engagement summaries"
  ON public.student_engagement_summary FOR SELECT
  USING (public.has_role(auth.uid(), 'guidance_counselor'::app_role));

DROP POLICY IF EXISTS "Students view own engagement summary" ON public.student_engagement_summary;
CREATE POLICY "Students view own engagement summary"
  ON public.student_engagement_summary FOR SELECT
  USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "Instructors view student engagement summary" ON public.student_engagement_summary;
CREATE POLICY "Instructors view student engagement summary"
  ON public.student_engagement_summary FOR SELECT
  USING (public.instructor_can_view_student(student_id));

-- ── student_engagement_feedback ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Guidance counselors view engagement feedback" ON public.student_engagement_feedback;
CREATE POLICY "Guidance counselors view engagement feedback"
  ON public.student_engagement_feedback FOR SELECT
  USING (public.has_role(auth.uid(), 'guidance_counselor'::app_role));

DROP POLICY IF EXISTS "Admins manage engagement feedback" ON public.student_engagement_feedback;
CREATE POLICY "Admins manage engagement feedback"
  ON public.student_engagement_feedback FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- ── engagement_alerts ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Guidance counselors view engagement alerts" ON public.engagement_alerts;
CREATE POLICY "Guidance counselors view engagement alerts"
  ON public.engagement_alerts FOR SELECT
  USING (public.has_role(auth.uid(), 'guidance_counselor'::app_role));

DROP POLICY IF EXISTS "Admins view all engagement alerts" ON public.engagement_alerts;
DROP POLICY IF EXISTS "Admins manage engagement alerts" ON public.engagement_alerts;
CREATE POLICY "Admins manage engagement alerts"
  ON public.engagement_alerts FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Students view own engagement alerts" ON public.engagement_alerts;
CREATE POLICY "Students view own engagement alerts"
  ON public.engagement_alerts FOR SELECT
  USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "Instructors view student engagement alerts" ON public.engagement_alerts;
CREATE POLICY "Instructors view student engagement alerts"
  ON public.engagement_alerts FOR SELECT
  USING (public.instructor_can_view_student(student_id));

DROP POLICY IF EXISTS "Instructors update engagement alerts" ON public.engagement_alerts;
CREATE POLICY "Instructors update engagement alerts"
  ON public.engagement_alerts FOR UPDATE
  USING (public.instructor_can_view_student(student_id))
  WITH CHECK (public.instructor_can_view_student(student_id));

-- ── engagement_interventions ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Guidance counselors view engagement interventions" ON public.engagement_interventions;
CREATE POLICY "Guidance counselors view engagement interventions"
  ON public.engagement_interventions FOR SELECT
  USING (public.has_role(auth.uid(), 'guidance_counselor'::app_role));

DROP POLICY IF EXISTS "Admins view engagement interventions" ON public.engagement_interventions;
DROP POLICY IF EXISTS "Admins manage engagement interventions" ON public.engagement_interventions;
CREATE POLICY "Admins manage engagement interventions"
  ON public.engagement_interventions FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Students view own engagement interventions" ON public.engagement_interventions;
CREATE POLICY "Students view own engagement interventions"
  ON public.engagement_interventions FOR SELECT
  USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "Instructors manage engagement interventions" ON public.engagement_interventions;
CREATE POLICY "Instructors manage engagement interventions"
  ON public.engagement_interventions FOR ALL
  USING (
    public.instructor_can_view_student(student_id)
    OR auth.uid() = instructor_id
  )
  WITH CHECK (
    auth.uid() = instructor_id
    AND public.instructor_can_view_student(student_id)
  );

-- ── Table privileges (RLS still enforces row scope) ──────────────────────────
GRANT SELECT ON public.student_engagement_summary TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.engagement_alerts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.engagement_interventions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.student_login_history TO authenticated;
GRANT SELECT, INSERT ON public.student_activity TO authenticated;

-- Ensure helper stays SECURITY DEFINER and scoped to enrolled subjects
CREATE OR REPLACE FUNCTION public.instructor_can_view_student(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.enrollments e
    JOIN public.subjects s ON s.id = e.subject_id
    WHERE e.student_id = p_student_id
      AND e.status = 'active'
      AND s.instructor_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.instructor_can_view_student(UUID) IS
  'True when the current user instructs an active subject that includes the student.';
