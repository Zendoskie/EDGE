create table if not exists public.student_feedback (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  prediction_id uuid null references public.predictions(id) on delete set null,
  risk_level text not null,
  reasons text[] not null default '{}'::text[],
  details text null,
  created_at timestamptz not null default now()
);

create index if not exists student_feedback_student_subject_idx
  on public.student_feedback (student_id, subject_id, created_at desc);

create index if not exists student_feedback_subject_created_idx
  on public.student_feedback (subject_id, created_at desc);

alter table public.student_feedback enable row level security;

drop policy if exists "students can manage own feedback" on public.student_feedback;
create policy "students can manage own feedback"
  on public.student_feedback
  for all
  using (auth.uid() = student_id)
  with check (auth.uid() = student_id);

drop policy if exists "instructors can view feedback for their subjects" on public.student_feedback;
create policy "instructors can view feedback for their subjects"
  on public.student_feedback
  for select
  using (
    exists (
      select 1
      from public.subjects s
      where s.id = student_feedback.subject_id
        and s.instructor_id = auth.uid()
    )
  );

drop policy if exists "guidance counselors can view feedback" on public.student_feedback;
create policy "guidance counselors can view feedback"
  on public.student_feedback
  for select
  using (public.has_role(auth.uid(), 'guidance_counselor'));

