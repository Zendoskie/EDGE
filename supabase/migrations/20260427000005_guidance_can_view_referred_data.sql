-- Allow guidance counselors to view the exact subject and profile data
-- for users involved in counseling referrals they can review.

DROP POLICY IF EXISTS "Guidance counselors can view referred profiles" ON public.profiles;
CREATE POLICY "Guidance counselors can view referred profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'guidance_counselor'::app_role)
  AND EXISTS (
    SELECT 1
    FROM public.counseling_referrals r
    WHERE r.student_id = profiles.user_id
       OR r.instructor_id = profiles.user_id
       OR r.reviewed_by = profiles.user_id
  )
);

DROP POLICY IF EXISTS "Guidance counselors can view referred subjects" ON public.subjects;
CREATE POLICY "Guidance counselors can view referred subjects"
ON public.subjects
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'guidance_counselor'::app_role)
  AND EXISTS (
    SELECT 1
    FROM public.counseling_referrals r
    WHERE r.subject_id = subjects.id
  )
);
