-- Add 'critical' risk level for students with very low scores
ALTER TABLE public.predictions DROP CONSTRAINT IF EXISTS predictions_risk_level_check;
ALTER TABLE public.predictions ADD CONSTRAINT predictions_risk_level_check
  CHECK (risk_level IN ('critical', 'at_risk', 'stable', 'excelling', 'Excelling', 'Stable', 'At Risk'));

-- Seed BSCS, BSBA, BEED, BSED programs (idempotent - only if missing)
INSERT INTO public.programs (code, name, description)
VALUES
  ('BSCS', 'Bachelor of Science in Computer Science', 'Computer Science degree program'),
  ('BSBA', 'Bachelor of Science in Business Administration', 'Business Administration degree program'),
  ('BEED', 'Bachelor of Elementary Education', 'Elementary Education degree program'),
  ('BSED', 'Bachelor of Secondary Education', 'Secondary Education degree program')
ON CONFLICT (code) DO NOTHING;
