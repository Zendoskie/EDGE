/** Embedded relations from Supabase select strings (until fully typed queries). */
export type EmbeddedProgram = { name?: string | null; code?: string | null };
export type EmbeddedProfile = {
  full_name?: string | null;
  email?: string | null;
  user_id?: string | null;
  student_id?: string | null;
};

export type EnrollmentListRow = {
  id: string;
  student_id: string;
  status?: string | null;
  profile?: EmbeddedProfile | null;
};

export type PredictionRow = {
  id: string;
  risk_level: string;
  student_id?: string | null;
  attendance_rate?: number | null;
  quiz_average?: number | null;
  assignment_average?: number | null;
  recommendation?: string | null;
  profile?: EmbeddedProfile | null;
};

export type SendNotificationResponse = {
  sent?: number;
  failed?: number;
  errors?: Array<{ index: number; message: string }>;
};

export type SubjectWithInstructor = {
  id: string;
  code: string;
  name: string;
  semester?: string | null;
  academic_year?: string | null;
  instructor_id?: string | null;
  programs?: EmbeddedProgram | EmbeddedProgram[] | null;
  instructor_profile?: EmbeddedProfile | null;
};
