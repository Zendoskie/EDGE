// Enrollment-request logic for the enroll-self Edge Function, kept free of Deno APIs so it can be
// unit-tested. A student request is always created as 'pending'; only an instructor activates it.

export interface EnrollmentInsertClient {
  from(table: "enrollments"): {
    insert(row: { student_id: string; subject_id: string; status: "pending" }): PromiseLike<{
      error: { code?: string; message: string } | null;
    }>;
  };
}

export interface EnrollmentRequestResult {
  status: number;
  body: Record<string, unknown>;
}

export async function requestEnrollment(
  db: EnrollmentInsertClient,
  userId: string,
  body: unknown,
): Promise<EnrollmentRequestResult> {
  const subjectId = typeof body === "object" && body !== null ? (body as { subject_id?: unknown }).subject_id : undefined;
  if (typeof subjectId !== "string" || !subjectId.trim()) {
    return { status: 400, body: { error: "subject_id is required" } };
  }

  // Only subject_id is taken from the request; any client-supplied status or student_id is ignored.
  const { error } = await db.from("enrollments").insert({ student_id: userId, subject_id: subjectId, status: "pending" });

  if (error) {
    if (error.code === "23505") {
      return {
        status: 409,
        body: { error: "already_enrolled", message: "You already have an enrollment or pending request for this course." },
      };
    }
    if (error.code === "42501") {
      return { status: 403, body: { error: "not_allowed", message: "You cannot request enrollment in this course." } };
    }
    throw error;
  }

  return { status: 200, body: { success: true, status: "pending" } };
}
