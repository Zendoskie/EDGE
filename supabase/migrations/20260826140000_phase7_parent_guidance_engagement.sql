-- Phase 7: parent engagement read access + guidance engagement referrals

-- Parents with an approved link can view the linked student's engagement summary (read-only).
DROP POLICY IF EXISTS "Parents view linked student engagement summary" ON public.student_engagement_summary;
CREATE POLICY "Parents view linked student engagement summary"
  ON public.student_engagement_summary FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.parent_student_links psl
      WHERE psl.parent_user_id = auth.uid()
        AND psl.student_user_id = student_engagement_summary.student_id
        AND psl.status = 'approved'
    )
  );

-- Parents can view open engagement alerts for their linked student (gentle visibility).
DROP POLICY IF EXISTS "Parents view linked student engagement alerts" ON public.engagement_alerts;
CREATE POLICY "Parents view linked student engagement alerts"
  ON public.engagement_alerts FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.parent_student_links psl
      WHERE psl.parent_user_id = auth.uid()
        AND psl.student_user_id = engagement_alerts.student_id
        AND psl.status = 'approved'
    )
  );

-- Guidance counselors may open an engagement-based counseling referral.
DROP POLICY IF EXISTS "Guidance can create engagement counseling referrals" ON public.counseling_referrals;
CREATE POLICY "Guidance can create engagement counseling referrals"
  ON public.counseling_referrals FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'guidance_counselor'::app_role)
    AND status = 'pending'
  );
