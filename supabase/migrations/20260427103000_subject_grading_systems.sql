create table if not exists public.subject_grading_systems (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null unique references public.subjects(id) on delete cascade,
  activity_weight integer not null default 25 check (activity_weight >= 0 and activity_weight <= 100),
  project_weight integer not null default 25 check (project_weight >= 0 and project_weight <= 100),
  attendance_weight integer not null default 15 check (attendance_weight >= 0 and attendance_weight <= 100),
  exam_weight integer not null default 35 check (exam_weight >= 0 and exam_weight <= 100),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subject_grading_systems_total_100_check check (
    activity_weight + project_weight + attendance_weight + exam_weight = 100
  )
);

alter table public.subject_grading_systems enable row level security;

create policy "subject owner can manage grading system"
on public.subject_grading_systems
for all
using (
  exists (
    select 1
    from public.subjects s
    where s.id = subject_grading_systems.subject_id
      and s.instructor_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.subjects s
    where s.id = subject_grading_systems.subject_id
      and s.instructor_id = auth.uid()
  )
);

create policy "students can view enrolled subject grading system"
on public.subject_grading_systems
for select
using (
  exists (
    select 1
    from public.enrollments e
    where e.subject_id = subject_grading_systems.subject_id
      and e.student_id = auth.uid()
      and coalesce(e.status, 'active') = 'active'
  )
);

create policy "parents can view linked student subject grading system"
on public.subject_grading_systems
for select
using (
  exists (
    select 1
    from public.parent_student_links psl
    join public.enrollments e on e.student_id = psl.student_user_id
    where psl.parent_user_id = auth.uid()
      and psl.status = 'approved'
      and e.subject_id = subject_grading_systems.subject_id
      and coalesce(e.status, 'active') = 'active'
  )
);
