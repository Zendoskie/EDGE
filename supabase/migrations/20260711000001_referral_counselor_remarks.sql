-- Optional counselor remarks on approve/reject decisions.

ALTER TABLE public.counseling_referrals
  ADD COLUMN IF NOT EXISTS counselor_remarks text;
