-- Create report_templates table for customizable report formats
CREATE TABLE public.report_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('student_performance', 'class_summary', 'attendance_analysis', 'risk_assessment', 'custom')),
  template_config JSONB,
  created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create generated_reports table for tracking report generation
CREATE TABLE public.generated_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES public.report_templates(id) ON DELETE CASCADE NOT NULL,
  parameters JSONB,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'completed', 'failed')),
  file_url TEXT,
  file_size INTEGER,
  generated_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL
);

-- Enable RLS
ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_reports ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Instructors can manage report templates" ON public.report_templates
  FOR ALL USING (public.has_role(auth.uid(), 'instructor'));

CREATE POLICY "Users can view their own generated reports" ON public.generated_reports
  FOR SELECT USING (auth.uid() = created_by);

CREATE POLICY "Instructors can manage generated reports" ON public.generated_reports
  FOR ALL USING (public.has_role(auth.uid(), 'instructor'));

-- Indexes
CREATE INDEX idx_generated_reports_created_by ON public.generated_reports(created_by, generated_at DESC);
CREATE INDEX idx_generated_reports_status ON public.generated_reports(status, generated_at DESC);

-- Insert default report templates (using NULL for created_by since it's system-generated)
INSERT INTO public.report_templates (name, description, type, template_config, created_by) VALUES
(
  'Student Performance Report',
  'Comprehensive performance analysis for individual students including grades, attendance, and risk assessments.',
  'student_performance',
  '{"includeGrades": true, "includeAttendance": true, "includePredictions": true, "dateRange": "last_semester"}',
  NULL
),
(
  'Class Summary Report',
  'Overview of class performance, engagement metrics, and overall trends.',
  'class_summary',
  '{"includePerformance": true, "includeEngagement": true, "includeTrends": true, "groupBy": "subject"}',
  NULL
),
(
  'Attendance Analysis Report',
  'Detailed attendance patterns, trends, and correlation with performance.',
  'attendance_analysis',
  '{"includePatterns": true, "includeCorrelation": true, "timeframe": "last_month"}',
  NULL
),
(
  'Risk Assessment Report',
  'Student risk analysis with intervention recommendations and progress tracking.',
  'risk_assessment',
  '{"includePredictions": true, "includeInterventions": true, "riskThreshold": "medium"}',
  NULL
);
