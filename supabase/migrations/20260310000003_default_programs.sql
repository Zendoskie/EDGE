-- Insert default academic programs
INSERT INTO public.programs (id, code, name, description, created_at) VALUES
  (gen_random_uuid(), 'BSCS', 'Bachelor of Science in Computer Science', 'Four-year degree program focusing on computer science fundamentals, programming, and software development.', now()),
  (gen_random_uuid(), 'BSBA', 'Bachelor of Science in Business Administration', 'Four-year degree program covering business management, finance, marketing, and entrepreneurship.', now()),
  (gen_random_uuid(), 'BEED', 'Bachelor of Elementary Education', 'Four-year degree program preparing students for teaching careers in elementary education.', now()),
  (gen_random_uuid(), 'BSED', 'Bachelor of Secondary Education', 'Four-year degree program preparing students for teaching careers in secondary education with various specializations.', now()),
  (gen_random_uuid(), 'BSIT', 'Bachelor of Science in Information Technology', 'Four-year degree program focusing on information systems, networking, and IT infrastructure management.', now()),
  (gen_random_uuid(), 'BSHM', 'Bachelor of Science in Hospitality Management', 'Four-year degree program covering hotel and restaurant management, tourism, and hospitality services.', now()),
  (gen_random_uuid(), 'BSTM', 'Bachelor of Science in Tourism Management', 'Four-year degree program focusing on tourism industry management, travel services, and destination marketing.', now()),
  (gen_random_uuid(), 'BSA', 'Bachelor of Science in Accountancy', 'Five-year degree program preparing students for professional accounting careers and CPA certification.', now());
