-- Step 2: counseling referral approval workflow (after enum migration).

CREATE TABLE IF NOT EXISTS public.counseling_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  instructor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prediction_id uuid REFERENCES public.predictions(id) ON DELETE SET NULL,
  recommendation_message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.counseling_referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Instructors can create counseling referrals" ON public.counseling_referrals;
CREATE POLICY "Instructors can create counseling referrals"
ON public.counseling_referrals
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'instructor'::app_role)
  AND instructor_id = auth.uid()
);

DROP POLICY IF EXISTS "Instructors can view own counseling referrals" ON public.counseling_referrals;
CREATE POLICY "Instructors can view own counseling referrals"
ON public.counseling_referrals
FOR SELECT
TO authenticated
USING (instructor_id = auth.uid());

DROP POLICY IF EXISTS "Students can view own counseling referrals" ON public.counseling_referrals;
CREATE POLICY "Students can view own counseling referrals"
ON public.counseling_referrals
FOR SELECT
TO authenticated
USING (student_id = auth.uid());

DROP POLICY IF EXISTS "Guidance counselors can view referrals" ON public.counseling_referrals;
CREATE POLICY "Guidance counselors can view referrals"
ON public.counseling_referrals
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'guidance_counselor'::app_role));

DROP POLICY IF EXISTS "Guidance counselors can review referrals" ON public.counseling_referrals;
CREATE POLICY "Guidance counselors can review referrals"
ON public.counseling_referrals
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'guidance_counselor'::app_role))
WITH CHECK (
  public.has_role(auth.uid(), 'guidance_counselor'::app_role)
  AND status IN ('approved', 'rejected')
  AND reviewed_by = auth.uid()
  AND reviewed_at IS NOT NULL
);

CREATE OR REPLACE FUNCTION public.enforce_counseling_intervention_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.type <> 'counseling' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.counseling_referrals r
    WHERE r.student_id = NEW.student_id
      AND r.subject_id = NEW.subject_id
      AND r.status = 'approved'
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'guidance_approval_required_for_counseling' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_counseling_intervention_approval ON public.interventions;
CREATE TRIGGER trg_enforce_counseling_intervention_approval
BEFORE INSERT OR UPDATE ON public.interventions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_counseling_intervention_approval();
