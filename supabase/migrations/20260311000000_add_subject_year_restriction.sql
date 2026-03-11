-- Add target_year field to subjects table for enrollment restrictions
ALTER TABLE public.subjects 
ADD COLUMN target_year INTEGER CHECK (target_year >= 1 AND target_year <= 4);

-- Add comment to explain the purpose
COMMENT ON COLUMN public.subjects.target_year IS 'Target year level for enrollment (1-4). When set, only students in this year level can enroll.';

-- Create function to check if student can enroll based on program and year
CREATE OR REPLACE FUNCTION public.can_student_enroll(subject_id UUID, student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    CASE 
      -- If subject has no program restriction, allow enrollment
      WHEN s.program_id IS NULL THEN true
      -- If subject has program restriction, check student's program
      WHEN s.program_id IS NOT NULL AND s.program_id = (SELECT program_id FROM student_programs WHERE student_id = $2 LIMIT 1) THEN
        CASE 
          -- If no year restriction, allow enrollment
          WHEN s.target_year IS NULL THEN true
          -- If year restriction, check student's year
          WHEN s.target_year IS NOT NULL AND s.target_year = (SELECT year_level FROM student_programs WHERE student_id = $2 LIMIT 1) THEN true
          ELSE false
        END
      ELSE false
    END
  FROM subjects s
  WHERE s.id = $1;
$$;

-- Create student_programs table to track student's program and year
CREATE TABLE IF NOT EXISTS public.student_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  program_id UUID REFERENCES public.programs(id) ON DELETE CASCADE,
  year_level INTEGER CHECK (year_level >= 1 AND year_level <= 4),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (student_id)
);

-- Add RLS for student_programs
ALTER TABLE public.student_programs ENABLE ROW LEVEL SECURITY;

-- Policies for student_programs
CREATE POLICY "Students can view own program info" ON public.student_programs 
  FOR SELECT USING (auth.uid() = student_id);

CREATE POLICY "Instructors can view all student program info" ON public.student_programs 
  FOR SELECT USING (public.has_role(auth.uid(), 'instructor'));

CREATE POLICY "Users can insert own program info" ON public.student_programs 
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = student_id);

CREATE POLICY "Users can update own program info" ON public.student_programs 
  FOR UPDATE USING (auth.uid() = student_id);

-- Trigger for updated_at on student_programs
CREATE TRIGGER update_student_programs_updated_at 
  BEFORE UPDATE ON public.student_programs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Update enrollment policy to check restrictions
DROP POLICY IF EXISTS "Students can insert own enrollment" ON public.enrollments;

CREATE POLICY "Students can insert own enrollment with restrictions"
  ON public.enrollments FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = student_id 
    AND public.can_student_enroll(subject_id, auth.uid())
  );
