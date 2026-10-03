-- Instructor deletion failed because academic records point at auth.users
-- without ON DELETE. Those columns are attribution only and already nullable.
-- Clearing them keeps subjects, grades, attendance, and programs in place.

ALTER TABLE public.subjects DROP CONSTRAINT IF EXISTS subjects_instructor_id_fkey;
ALTER TABLE public.subjects
  ADD CONSTRAINT subjects_instructor_id_fkey
  FOREIGN KEY (instructor_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.programs DROP CONSTRAINT IF EXISTS programs_created_by_fkey;
ALTER TABLE public.programs
  ADD CONSTRAINT programs_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_created_by_fkey;
ALTER TABLE public.activities
  ADD CONSTRAINT activities_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_grades_published_by_fkey;
ALTER TABLE public.activities
  ADD CONSTRAINT activities_grades_published_by_fkey
  FOREIGN KEY (grades_published_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_recorded_by_fkey;
ALTER TABLE public.attendance
  ADD CONSTRAINT attendance_recorded_by_fkey
  FOREIGN KEY (recorded_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.submissions DROP CONSTRAINT IF EXISTS submissions_graded_by_fkey;
ALTER TABLE public.submissions
  ADD CONSTRAINT submissions_graded_by_fkey
  FOREIGN KEY (graded_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.learning_resources DROP CONSTRAINT IF EXISTS learning_resources_created_by_fkey;
ALTER TABLE public.learning_resources
  ADD CONSTRAINT learning_resources_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
