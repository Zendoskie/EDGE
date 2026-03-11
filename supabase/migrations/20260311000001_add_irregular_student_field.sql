-- Add is_irregular field to student_programs table
ALTER TABLE public.student_programs 
ADD COLUMN is_irregular BOOLEAN DEFAULT false;

-- Add comment to explain the purpose
COMMENT ON COLUMN public.student_programs.is_irregular IS 'Whether the student is irregular (can enroll in any course regardless of restrictions).';

-- Update the can_student_enroll function to handle irregular students
CREATE OR REPLACE FUNCTION public.can_student_enroll(subject_id UUID, student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    CASE 
      -- Irregular students can enroll in any course
      WHEN sp.is_irregular = true THEN true
      -- If subject has no program restriction, allow enrollment
      WHEN s.program_id IS NULL THEN true
      -- If subject has program restriction, check student's program
      WHEN s.program_id IS NOT NULL AND s.program_id = sp.program_id THEN
        CASE 
          -- If no year restriction, allow enrollment
          WHEN s.target_year IS NULL THEN true
          -- If year restriction, check student's year
          WHEN s.target_year IS NOT NULL AND s.target_year = sp.year_level THEN true
          ELSE false
        END
      ELSE false
    END
  FROM subjects s
  LEFT JOIN student_programs sp ON sp.student_id = $2
  WHERE s.id = $1;
$$;
