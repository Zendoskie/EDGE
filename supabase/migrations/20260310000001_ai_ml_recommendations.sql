-- Create learning_recommendations table for AI-powered suggestions
CREATE TABLE public.learning_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE CASCADE,
  recommendation_type TEXT NOT NULL CHECK (recommendation_type IN ('study_resource', 'time_management', 'learning_style', 'collaboration', 'remediation')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  confidence_score DECIMAL(3,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
  is_actioned BOOLEAN DEFAULT false,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create study_patterns table for tracking learning behavior
CREATE TABLE public.study_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE CASCADE,
  study_date DATE NOT NULL,
  study_duration_minutes INTEGER NOT NULL,
  time_of_day TEXT CHECK (time_of_day IN ('morning', 'afternoon', 'evening', 'night')),
  activity_type TEXT NOT NULL CHECK (activity_type IN ('reading', 'practice', 'review', 'assignment', 'discussion')),
  completion_rate DECIMAL(5,2) CHECK (completion_rate >= 0 AND completion_rate <= 100),
  difficulty_rating INTEGER CHECK (difficulty_rating >= 1 AND difficulty_rating <= 5),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create learning_resources table for recommended materials
CREATE TABLE public.learning_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('video', 'article', 'quiz', 'exercise', 'book', 'website', 'tool')),
  url TEXT,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE CASCADE,
  difficulty_level INTEGER CHECK (difficulty_level >= 1 AND difficulty_level <= 5),
  estimated_time_minutes INTEGER,
  tags TEXT[],
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create student_resource_interactions table for tracking engagement
CREATE TABLE public.student_resource_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  resource_id UUID REFERENCES public.learning_resources(id) ON DELETE CASCADE NOT NULL,
  interaction_type TEXT NOT NULL CHECK (interaction_type IN ('viewed', 'bookmarked', 'completed', 'rated', 'shared')),
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  feedback TEXT,
  time_spent_minutes INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create peer_connections table for collaboration recommendations
CREATE TABLE public.peer_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  peer_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE CASCADE,
  connection_strength DECIMAL(3,2) CHECK (connection_strength >= 0 AND connection_strength <= 1),
  collaboration_history TEXT[],
  recommended_by TEXT CHECK (recommended_by IN ('ai', 'instructor', 'peer')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (student_id, peer_id, subject_id)
);

-- Enable RLS on all AI/ML tables
ALTER TABLE public.learning_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_resource_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peer_connections ENABLE ROW LEVEL SECURITY;

-- RLS policies for learning recommendations
CREATE POLICY "Students can view their own recommendations" ON public.learning_recommendations
  FOR SELECT USING (auth.uid() = student_id);

CREATE POLICY "Instructors can view recommendations for their students" ON public.learning_recommendations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.enrollments
      JOIN public.subjects ON subjects.id = enrollments.subject_id
      WHERE enrollments.student_id = learning_recommendations.student_id
      AND subjects.instructor_id = auth.uid()
    )
  );

-- RLS policies for study patterns
CREATE POLICY "Students can view their own study patterns" ON public.study_patterns
  FOR SELECT USING (auth.uid() = student_id);

CREATE POLICY "Students can manage their own study patterns" ON public.study_patterns
  FOR ALL USING (auth.uid() = student_id);

-- RLS policies for learning resources
CREATE POLICY "Anyone can view active learning resources" ON public.learning_resources
  FOR SELECT USING (is_active = true);

CREATE POLICY "Instructors can manage learning resources" ON public.learning_resources
  FOR ALL USING (public.has_role(auth.uid(), 'instructor'));

-- RLS policies for student resource interactions
CREATE POLICY "Students can manage their own resource interactions" ON public.student_resource_interactions
  FOR ALL USING (auth.uid() = student_id);

-- RLS policies for peer connections
CREATE POLICY "Students can view their own peer connections" ON public.peer_connections
  FOR SELECT USING (auth.uid() = student_id);

CREATE POLICY "Students can manage their own peer connections" ON public.peer_connections
  FOR ALL USING (auth.uid() = student_id);

-- Indexes for performance
CREATE INDEX idx_learning_recommendations_student_priority ON public.learning_recommendations(student_id, priority DESC);
CREATE INDEX idx_study_patterns_student_date ON public.study_patterns(student_id, study_date DESC);
CREATE INDEX idx_learning_resources_subject_type ON public.learning_resources(subject_id, resource_type);
CREATE INDEX idx_student_resource_interactions_student ON public.student_resource_interactions(student_id, created_at DESC);
CREATE INDEX idx_peer_connections_student_strength ON public.peer_connections(student_id, connection_strength DESC);

-- AI recommendation generation function
CREATE OR REPLACE FUNCTION public.generate_learning_recommendations(
  p_student_id UUID,
  p_subject_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  recommendation_type TEXT,
  title TEXT,
  description TEXT,
  priority TEXT,
  confidence_score DECIMAL(3,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_avg_score DECIMAL(5,2);
  v_attendance_rate DECIMAL(5,2);
  v_risk_level TEXT;
  v_learning_style TEXT;
BEGIN
  -- Get student performance metrics
  SELECT 
    AVG(s.score::DECIMAL / a.max_score * 100) as avg_score,
    AVG(CASE WHEN att.status IN ('present', 'late') THEN 100 ELSE 0 END) as attendance_rate
  INTO v_avg_score, v_attendance_rate
  FROM public.submissions s
  JOIN public.activities a ON s.activity_id = a.id
  JOIN public.attendance att ON att.student_id = p_student_id
  WHERE s.student_id = p_student_id
  AND (p_subject_id IS NULL OR a.subject_id = p_subject_id);
  
  -- Generate recommendations based on performance
  RETURN QUERY
  SELECT 
    gen_random_uuid() as id,
    CASE 
      WHEN v_avg_score < 60 THEN 'remediation'
      WHEN v_attendance_rate < 80 THEN 'time_management'
      WHEN v_avg_score BETWEEN 60 AND 75 THEN 'study_resource'
      ELSE 'collaboration'
    END as recommendation_type,
    CASE 
      WHEN v_avg_score < 60 THEN 'Focus on Foundational Concepts'
      WHEN v_attendance_rate < 80 THEN 'Improve Study Schedule'
      WHEN v_avg_score BETWEEN 60 AND 75 THEN 'Additional Practice Resources'
      ELSE 'Peer Study Groups'
    END as title,
    CASE 
      WHEN v_avg_score < 60 THEN 'Your scores indicate you need to strengthen fundamental concepts. Focus on foundational materials before advancing.'
      WHEN v_attendance_rate < 80 THEN 'Regular attendance is crucial for success. Consider adjusting your schedule to ensure consistent presence.'
      WHEN v_avg_score BETWEEN 60 AND 75 THEN 'You''re doing well but could benefit from additional practice materials to reach excellence.'
      ELSE 'Collaborative learning can enhance your understanding. Consider forming study groups.'
    END as description,
    CASE 
      WHEN v_avg_score < 60 OR v_attendance_rate < 80 THEN 'high'
      WHEN v_avg_score BETWEEN 60 AND 75 THEN 'medium'
      ELSE 'low'
    END as priority,
    CASE 
      WHEN v_avg_score < 60 OR v_attendance_rate < 80 THEN 0.85
      WHEN v_avg_score BETWEEN 60 AND 75 THEN 0.70
      ELSE 0.60
    END as confidence_score;
END;
$$;
