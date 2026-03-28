-- In-app notification bell: add tables to Realtime so students receive postgres_changes events.
-- See docs/NEW_SUPABASE_SETUP.md → "Step 4b: In-app notification bell (Realtime)".
-- If a table is already in supabase_realtime, that ALTER line may error; skip or ignore.

ALTER PUBLICATION supabase_realtime ADD TABLE public.submissions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.predictions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance;
