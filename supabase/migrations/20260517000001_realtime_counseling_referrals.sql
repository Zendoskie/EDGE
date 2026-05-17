-- Enable Realtime for counseling referral status updates (student/instructor/counselor in-app notifications).
ALTER PUBLICATION supabase_realtime ADD TABLE public.counseling_referrals;
