-- Enable Realtime for parent/guardian access request notifications.
ALTER PUBLICATION supabase_realtime ADD TABLE public.parent_student_links;
