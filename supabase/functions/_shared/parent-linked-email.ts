import type { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  deliverEmail,
  emailLogKey,
  parentAttendanceUpdateEmail,
  parentAttendanceUpdateLogId,
  parentGradesPostedEmail,
  parentGradesPostedLogId,
  parentReferralUpdateEmail,
  parentReferralUpdateLogId,
  parentRiskTransitionEmail,
  parentRiskTransitionLogId,
  shouldNotifyParentRiskTransition,
} from "./notification-channels.ts";
import {
  listApprovedLinkedParents,
  mapApprovedLinkedParentsByStudent,
  type LinkedParentRecipient,
} from "./linked-parent-recipients.ts";
import type { SendAppEmail } from "./resend-email.ts";

export type ParentEmailCounts = { sent: number; failed: number; duplicates: number };

export async function emailLinkedParentsGradesPosted(
  supabase: ReturnType<typeof createClient>,
  sendAppEmail: SendAppEmail,
  studentId: string,
  subjectId: string,
  subjectCode: string | null,
  lines: Array<{ activityId: string; title: string; score: number }>,
): Promise<ParentEmailCounts> {
  let sent = 0;
  let failed = 0;
  let duplicates = 0;
  if (lines.length === 0) return { sent, failed, duplicates };

  const parents = await listApprovedLinkedParents(supabase, studentId);
  if (parents.length === 0) return { sent, failed, duplicates };

  const { data: studentProfile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("user_id", studentId)
    .maybeSingle();

  for (const parent of parents) {
    const pendingLines = [];
    for (const line of lines) {
      const logKey = emailLogKey(
        "parent_grades_posted",
        parentGradesPostedLogId(parent.parentUserId, line.activityId, studentId),
      );
      const { data: existing } = await supabase
        .from("email_notifications")
        .select("id")
        .eq("student_id", parent.parentUserId)
        .eq("risk_level", logKey)
        .limit(1);
      if ((existing ?? []).length > 0) {
        duplicates += 1;
        continue;
      }
      pendingLines.push(line);
    }
    if (pendingLines.length === 0) continue;

    const email = parentGradesPostedEmail({
      studentName: studentProfile?.full_name ?? null,
      subjectCode,
      lines: pendingLines.map((line) => ({ title: line.title, score: line.score })),
    });
    const delivery = await deliverEmail({
      alreadyLogged: false,
      send: () => sendAppEmail({ to: parent.email, subject: email.subject, html: email.html }),
      log: async () => {
        const rows = pendingLines.map((line) => ({
          student_id: parent.parentUserId,
          subject_id: subjectId,
          risk_level: emailLogKey(
            "parent_grades_posted",
            parentGradesPostedLogId(parent.parentUserId, line.activityId, studentId),
          ),
          channel: "email",
        }));
        const { error: logError } = await supabase.from("email_notifications").insert(rows);
        if (logError) throw logError;
      },
    });
    if (delivery === "failed") failed += 1;
    else if (delivery === "duplicate") duplicates += pendingLines.length;
    else sent += 1;
  }
  return { sent, failed, duplicates };
}

export async function emailLinkedParentsAttendanceUpdate(
  supabase: ReturnType<typeof createClient>,
  sendAppEmail: SendAppEmail,
  input: {
    studentUserId: string;
    subjectId: string;
    subjectCode: string | null;
    date: string;
    status: string;
    studentAttendanceLogKey: string;
  },
): Promise<ParentEmailCounts> {
  let sent = 0;
  let failed = 0;
  let duplicates = 0;

  const parents = await listApprovedLinkedParents(supabase, input.studentUserId);
  if (parents.length === 0) return { sent, failed, duplicates };

  const { data: studentProfile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("user_id", input.studentUserId)
    .maybeSingle();

  const emailContent = parentAttendanceUpdateEmail({
    studentName: studentProfile?.full_name ?? null,
    subjectCode: input.subjectCode,
    date: input.date,
    status: input.status,
  });

  for (const parent of parents) {
    const logKey = emailLogKey(
      "parent_attendance_update",
      parentAttendanceUpdateLogId(parent.parentUserId, input.studentAttendanceLogKey),
    );
    const { data: existing } = await supabase
      .from("email_notifications")
      .select("id")
      .eq("student_id", parent.parentUserId)
      .eq("risk_level", logKey)
      .limit(1);

    const delivery = await deliverEmail({
      alreadyLogged: (existing ?? []).length > 0,
      send: () => sendAppEmail({ to: parent.email, subject: emailContent.subject, html: emailContent.html }),
      log: async () => {
        const { error: logError } = await supabase.from("email_notifications").insert({
          student_id: parent.parentUserId,
          subject_id: input.subjectId,
          risk_level: logKey,
          channel: "email",
        });
        if (logError) throw logError;
      },
    });
    if (delivery === "failed") failed += 1;
    else if (delivery === "duplicate") duplicates += 1;
    else sent += 1;
  }
  return { sent, failed, duplicates };
}

export type ParentRiskTransition = {
  studentUserId: string;
  subjectId: string;
  subjectCode: string;
  predictionId: string;
  previousLevel: string;
  newLevel: string;
  writeStamp: string;
};

export async function emailLinkedParentsRiskTransitions(
  supabase: ReturnType<typeof createClient>,
  sendAppEmail: SendAppEmail,
  transitions: readonly ParentRiskTransition[],
): Promise<ParentEmailCounts> {
  let sent = 0;
  let failed = 0;
  let duplicates = 0;

  const eligible = transitions.filter((row) =>
    shouldNotifyParentRiskTransition(row.previousLevel, row.newLevel),
  );
  if (eligible.length === 0) return { sent, failed, duplicates };

  const parentsByStudent = await mapApprovedLinkedParentsByStudent(
    supabase,
    eligible.map((row) => row.studentUserId),
  );
  if (parentsByStudent.size === 0) return { sent, failed, duplicates };

  const studentIds = [...new Set(eligible.map((row) => row.studentUserId))];
  const { data: studentProfiles } = await supabase
    .from("profiles")
    .select("user_id, full_name")
    .in("user_id", studentIds);
  const nameByStudent = new Map(
    (studentProfiles ?? []).map((row) => [row.user_id, row.full_name ?? null]),
  );

  for (const transition of eligible) {
    const parents = parentsByStudent.get(transition.studentUserId) ?? [];
    if (parents.length === 0) continue;

    const emailContent = parentRiskTransitionEmail({
      studentName: nameByStudent.get(transition.studentUserId) ?? null,
      subjectCode: transition.subjectCode,
      previousLevel: transition.previousLevel,
      newLevel: transition.newLevel,
    });

    for (const parent of parents) {
      const logKey = emailLogKey(
        "parent_risk_update",
        parentRiskTransitionLogId(
          parent.parentUserId,
          transition.predictionId,
          transition.previousLevel,
          transition.newLevel,
          transition.writeStamp,
        ),
      );
      const { data: existing } = await supabase
        .from("email_notifications")
        .select("id")
        .eq("student_id", parent.parentUserId)
        .eq("risk_level", logKey)
        .limit(1);

      const delivery = await deliverEmail({
        alreadyLogged: (existing ?? []).length > 0,
        send: () => sendAppEmail({ to: parent.email, subject: emailContent.subject, html: emailContent.html }),
        log: async () => {
          const { error: logError } = await supabase.from("email_notifications").insert({
            student_id: parent.parentUserId,
            subject_id: transition.subjectId,
            risk_level: logKey,
            channel: "email",
          });
          if (logError) throw logError;
        },
      });
      if (delivery === "failed") failed += 1;
      else if (delivery === "duplicate") duplicates += 1;
      else sent += 1;
    }
  }
  return { sent, failed, duplicates };
}

export async function emailLinkedParentsReferralUpdate(
  supabase: ReturnType<typeof createClient>,
  sendAppEmail: SendAppEmail,
  input: {
    studentUserId: string;
    subjectId: string;
    subjectCode: string;
    referralId: string;
    event: "referral_created" | "referral_decided";
    decision?: string | null;
  },
): Promise<ParentEmailCounts> {
  let sent = 0;
  let failed = 0;
  let duplicates = 0;

  const parents = await listApprovedLinkedParents(supabase, input.studentUserId);
  if (parents.length === 0) return { sent, failed, duplicates };

  const { data: studentProfile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("user_id", input.studentUserId)
    .maybeSingle();

  const emailContent = parentReferralUpdateEmail({
    studentName: studentProfile?.full_name ?? null,
    subjectCode: input.subjectCode,
    event: input.event,
    decision: input.decision ?? null,
  });

  for (const parent of parents) {
    const logKey = emailLogKey(
      "parent_referral_update",
      parentReferralUpdateLogId(parent.parentUserId, input.referralId, input.event),
    );
    const { data: existing } = await supabase
      .from("email_notifications")
      .select("id")
      .eq("student_id", parent.parentUserId)
      .eq("risk_level", logKey)
      .limit(1);

    const delivery = await deliverEmail({
      alreadyLogged: (existing ?? []).length > 0,
      send: () => sendAppEmail({ to: parent.email, subject: emailContent.subject, html: emailContent.html }),
      log: async () => {
        const { error: logError } = await supabase.from("email_notifications").insert({
          student_id: parent.parentUserId,
          subject_id: input.subjectId,
          risk_level: logKey,
          channel: "email",
        });
        if (logError) throw logError;
      },
    });
    if (delivery === "failed") failed += 1;
    else if (delivery === "duplicate") duplicates += 1;
    else sent += 1;
  }
  return { sent, failed, duplicates };
}
