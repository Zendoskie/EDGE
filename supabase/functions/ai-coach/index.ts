import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildStudentRecord,
  canonicalRiskLevel,
  riskStatusLabel,
  type CanonicalRiskLevel,
  type RawEngagement,
  type StudentRecord,
} from "./academic-context.ts";
import {
  COACHING_ROLE_PROMPT,
  callOpenAiChat,
  runCoachChat,
  sanitizeConversation,
} from "./coach-chat.ts";

/**
 * Security model: every database read in this function runs as the signed-in user
 * (anon key + the caller's JWT), so Postgres RLS decides what rows exist for the AI.
 * The service-role key is deliberately NOT used here, and any student id supplied by
 * the client is ignored: identity comes only from the verified JWT.
 */

const MAX_INSIGHT_TOKENS = 500;
const RATE_LIMIT_REQUESTS = 20;
const RATE_LIMIT_WINDOW = 60;

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

class CoachDataError extends Error {
  constructor(public readonly source: string) {
    super(source);
    this.name = "CoachDataError";
  }
}

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || Deno.env.get("FRONTEND_URL") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const windowMs = RATE_LIMIT_WINDOW * 1000;
  const userLimit = rateLimitMap.get(userId);
  if (!userLimit || now > userLimit.resetTime) {
    rateLimitMap.set(userId, { count: 1, resetTime: now + windowMs });
    return true;
  }
  if (userLimit.count >= RATE_LIMIT_REQUESTS) return false;
  userLimit.count++;
  return true;
}

function safeString(s: unknown): string | null {
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

function aiEnabled(): boolean {
  const enabled = (Deno.env.get("AI_COACH_ENABLED") || "true").toLowerCase();
  return enabled === "true" || enabled === "1" || enabled === "yes";
}

function getOpenAiConfig(): { apiKey: string; model: string } | null {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return null;
  return { apiKey, model: Deno.env.get("OPENAI_MODEL") || "gpt-5.4-mini" };
}

/* ------------------------------------------------------------ insight-mode helpers */

type SubjectCoachingMetrics = {
  subjectId: string;
  subjectCode: string;
  subjectName: string | null;
  riskClassification: CanonicalRiskLevel;
  riskScore: number | null;
  attendancePercent: number | null;
  activityScorePercent: number | null;
  quizScorePercent: number | null;
  laboratoryExamPercent: number | null;
  comprehensionRating: number | null;
  createdAt: string | null;
};

const RISK_PRIORITY: Record<CanonicalRiskLevel, number> = { excelling: 0, stable: 1, at_risk: 2, critical: 3 };

function createdAtTs(value: unknown): number {
  if (typeof value !== "string") return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function pctFromRate(rate: number | null | undefined): number | null {
  if (rate == null || !Number.isFinite(rate)) return null;
  return rate <= 1 ? Math.round(rate * 1000) / 10 : Math.round(rate * 10) / 10;
}

function pctDirect(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

type PredictionRow = {
  subject_id?: string | null;
  risk_level?: string | null;
  risk_score?: number | null;
  attendance_rate?: number | null;
  activity_average?: number | null;
  activity_completion_rate?: number | null;
  quiz_average?: number | null;
  laboratory_exam_average?: number | null;
  comprehension_rating?: number | null;
  created_at?: string | null;
  subjects?: { code?: string | null; name?: string | null } | null;
};

function mapPredictionRow(row: PredictionRow): SubjectCoachingMetrics | null {
  const subjectId = typeof row.subject_id === "string" ? row.subject_id : null;
  if (!subjectId) return null;
  return {
    subjectId,
    subjectCode: row.subjects?.code ?? "Subject",
    subjectName: row.subjects?.name ?? null,
    riskClassification: canonicalRiskLevel(row.risk_level),
    // Official risk score only: no substitute value is ever shown as a risk score.
    riskScore:
      row.risk_score != null && Number.isFinite(row.risk_score) ? Math.round(row.risk_score * 10) / 10 : null,
    attendancePercent: pctFromRate(row.attendance_rate),
    activityScorePercent:
      pctDirect(row.activity_average) ??
      (row.activity_completion_rate != null ? pctFromRate(row.activity_completion_rate) : null),
    quizScorePercent: pctDirect(row.quiz_average),
    laboratoryExamPercent: pctDirect(row.laboratory_exam_average),
    comprehensionRating:
      row.comprehension_rating != null && Number.isFinite(row.comprehension_rating)
        ? Math.round(row.comprehension_rating * 10) / 10
        : null,
    createdAt: row.created_at ?? null,
  };
}

function buildLatestPerSubject<T extends { subject_id?: string | null }>(rows: T[]): T[] {
  const bySubject = new Map<string, T>();
  for (const row of rows) {
    const sid = typeof row.subject_id === "string" ? row.subject_id : null;
    if (!sid || bySubject.has(sid)) continue;
    bySubject.set(sid, row);
  }
  return Array.from(bySubject.values());
}

function rankCoachingSubjects(subjects: SubjectCoachingMetrics[]): SubjectCoachingMetrics[] {
  return [...subjects].sort((a, b) => {
    const pa = RISK_PRIORITY[a.riskClassification];
    const pb = RISK_PRIORITY[b.riskClassification];
    if (pa !== pb) return pb - pa;
    return createdAtTs(b.createdAt) - createdAtTs(a.createdAt);
  });
}

function formatMetricsBlock(m: SubjectCoachingMetrics): string {
  return [
    `Subject: ${m.subjectCode}${m.subjectName ? ` — ${m.subjectName}` : ""}`,
    `Risk classification (system-computed): ${riskStatusLabel(m.riskClassification)}`,
    m.riskScore != null ? `Risk score: ${m.riskScore}` : null,
    m.attendancePercent != null ? `Attendance: ${m.attendancePercent}%` : null,
    m.activityScorePercent != null ? `Activity scores: ${m.activityScorePercent}%` : null,
    m.quizScorePercent != null ? `Quiz scores: ${m.quizScorePercent}%` : null,
    m.laboratoryExamPercent != null ? `Laboratory exam scores: ${m.laboratoryExamPercent}%` : null,
    m.comprehensionRating != null ? `Comprehension rating: ${m.comprehensionRating}/5` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/* ------------------------------------------------------------ student record loader (RLS) */

type Db = ReturnType<typeof createClient>;

function engagementLevelLabel(level: string): string {
  const normalized = level.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized === "very_high" || normalized === "highly_active") return "Highly Active";
  if (normalized === "high" || normalized === "active") return "Active";
  if (normalized === "low" || normalized === "inactive") return "Inactive";
  return "Low Engagement";
}

async function loadEngagement(db: Db, userId: string): Promise<RawEngagement | null> {
  const [summaryRes, activityRes] = await Promise.all([
    db
      .from("student_engagement_summary")
      .select("engagement_level, engagement_score, total_login_count, participation_count")
      .eq("student_id", userId)
      .maybeSingle(),
    db
      .from("student_activity")
      .select("activity_type, activity_description, created_at")
      .eq("student_id", userId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  if (summaryRes.error && activityRes.error) return null;
  const summary = summaryRes.data;
  const recent = activityRes.data ?? [];
  if (!summary && recent.length === 0) return null;
  return {
    engagementLevel: engagementLevelLabel(String(summary?.engagement_level ?? "moderate")),
    engagementScore:
      summary?.engagement_score != null && Number.isFinite(Number(summary.engagement_score))
        ? Math.round(Number(summary.engagement_score) * 10) / 10
        : null,
    totalLoginCount: Number(summary?.total_login_count ?? 0),
    participationCount: Number(summary?.participation_count ?? 0),
    recentActivities: recent.map((r: { activity_type?: string; activity_description?: string | null }) =>
      (r.activity_description?.trim() || String(r.activity_type ?? "activity").replace(/_/g, " ")),
    ),
  };
}

async function loadStudentRecord(db: Db, userId: string): Promise<StudentRecord> {
  const enr = await db
    .from("enrollments")
    .select("subject_id, subjects(code, name)")
    .eq("student_id", userId)
    .eq("status", "active");
  if (enr.error) throw new CoachDataError("enrollments");

  const enrollments = enr.data ?? [];
  const subjectIds = enrollments
    .map((e: { subject_id?: string | null }) => e.subject_id)
    .filter((id: string | null | undefined): id is string => Boolean(id));

  if (subjectIds.length === 0) {
    return buildStudentRecord({
      enrollments: [],
      activities: [],
      submissions: [],
      attendance: [],
      gradingSystems: [],
      predictions: [],
      engagement: null,
    });
  }

  const [acts, subs, att, grading, preds, engagement] = await Promise.all([
    db.from("activities").select("id, subject_id, title, type, max_score, due_date").in("subject_id", subjectIds).limit(1000),
    db.from("submissions").select("activity_id, score, assessment_type").eq("student_id", userId).limit(1000),
    db.from("attendance").select("subject_id, status").eq("student_id", userId).in("subject_id", subjectIds).limit(1000),
    db
      .from("subject_grading_systems")
      .select("subject_id, activity_weight, project_weight, attendance_weight, exam_weight")
      .in("subject_id", subjectIds),
    db.rpc("latest_student_predictions", { p_student_id: userId }),
    loadEngagement(db, userId).catch(() => null),
  ]);

  if (acts.error) throw new CoachDataError("activities");
  if (subs.error) throw new CoachDataError("submissions");
  if (att.error) throw new CoachDataError("attendance");
  if (grading.error) throw new CoachDataError("grading");

  return buildStudentRecord({
    enrollments,
    activities: acts.data ?? [],
    submissions: subs.data ?? [],
    attendance: att.data ?? [],
    gradingSystems: grading.data ?? [],
    predictions: preds.error ? null : (preds.data ?? []),
    engagement,
  });
}

/* ------------------------------------------------------------ handler */

const GENERIC_FAILURE = "Something went wrong on our side. Please try again in a moment.";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
    if (!authHeader || !token) return json(req, { error: "Authentication required" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) {
      console.error("ai-coach: missing SUPABASE_URL or SUPABASE_ANON_KEY");
      return json(req, { error: GENERIC_FAILURE }, 500);
    }

    const db = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: authError,
    } = await db.auth.getUser(token);
    if (authError || !user) {
      return json(req, { error: "Authentication required. Please sign in again." }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const mode = safeString(body?.mode) || "chat";

    if (!checkRateLimit(user.id)) {
      return json(req, { error: "Too many requests. Please try again later." }, 429);
    }

    if (mode === "predictions_insight") {
      return await handleInsight(req, db, user.id);
    }

    const ai = getOpenAiConfig();
    const conversation = sanitizeConversation(body?.messages, body?.message);

    const result = await runCoachChat(
      {
        loadRecord: () => loadStudentRecord(db, user.id),
        aiEnabled: aiEnabled(),
        callModel: async (system, messages) => {
          if (!ai) {
            console.error("ai-coach: OPENAI_API_KEY is not configured");
            throw new Error("not_configured");
          }
          return await callOpenAiChat({ apiKey: ai.apiKey, model: ai.model, system, messages });
        },
      },
      conversation,
    );

    return json(req, result);
  } catch (e) {
    console.error("ai-coach error:", e instanceof Error ? e.name : "unknown");
    return json(req, { error: GENERIC_FAILURE }, 500);
  }
});

async function handleInsight(req: Request, db: Db, userId: string): Promise<Response> {
  if (!aiEnabled()) return json(req, { insight: "AI insights are disabled." });

  const ai = getOpenAiConfig();
  const { data: roleRow, error: roleError } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (roleError) return json(req, { insight: "Could not load your insights right now. Please try again later." });

  let contextBlock = "";

  if (roleRow?.role === "instructor") {
    const { data: subjects } = await db.from("subjects").select("id, code, name").eq("instructor_id", userId);
    const ids = (subjects ?? []).map((s: { id: string }) => s.id).filter(Boolean);
    if (ids.length === 0) {
      return json(req, { insight: "Create subjects and run predictions to see an AI summary here." });
    }

    const { data: predsRaw } = await db
      .from("predictions")
      .select(
        "risk_level, risk_score, attendance_rate, activity_average, activity_completion_rate, quiz_average, laboratory_exam_average, comprehension_rating, subject_id, student_id, subjects(code, name)",
      )
      .in("subject_id", ids)
      .order("created_at", { ascending: false })
      .limit(120);

    const { data: enrollRows } = await db
      .from("enrollments")
      .select("student_id, subject_id")
      .in("subject_id", ids)
      .eq("status", "active");

    const activeKeys = new Set(
      (enrollRows ?? [])
        .filter((e: { student_id?: string; subject_id?: string }) => e.student_id && e.subject_id)
        .map((e: { student_id: string; subject_id: string }) => `${e.student_id}::${e.subject_id}`),
    );

    const latest: PredictionRow[] = [];
    const seen = new Set<string>();
    for (const row of (predsRaw ?? []) as Array<PredictionRow & { student_id?: string }>) {
      const key = `${row.student_id}::${row.subject_id}`;
      if (!row.student_id || !row.subject_id || !activeKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      latest.push(row);
      if (latest.length >= 80) break;
    }

    if (latest.length === 0) {
      return json(req, {
        insight: "No predictions yet. Run risk analysis from a subject page to see an AI summary here.",
      });
    }

    const lines = latest.map((p) => mapPredictionRow(p)).filter((m): m is SubjectCoachingMetrics => m != null).map(formatMetricsBlock);
    contextBlock = [
      "You are helping an INSTRUCTOR review class-wide risk analysis results.",
      "Do NOT reclassify students. Summarize patterns, weak areas, and coaching priorities across subjects.",
      "",
      "System-computed metrics (latest per student/subject):",
      lines.join("\n\n"),
    ].join("\n");
  } else {
    const { data: enrollRows } = await db
      .from("enrollments")
      .select("subject_id")
      .eq("student_id", userId)
      .eq("status", "active");
    const enrolledSubjectIds = (enrollRows ?? [])
      .map((r: { subject_id?: string | null }) => r.subject_id)
      .filter((id: string | null | undefined): id is string => Boolean(id));
    if (enrolledSubjectIds.length === 0) {
      return json(req, {
        insight:
          "No enrolled subjects found yet. Once you are enrolled in a course, prediction summaries can appear here after your instructor runs risk analysis.",
      });
    }

    const { data: preds } = await db
      .from("predictions")
      .select(
        "risk_level, risk_score, attendance_rate, activity_average, activity_completion_rate, quiz_average, laboratory_exam_average, comprehension_rating, created_at, subject_id, subjects(code, name)",
      )
      .eq("student_id", userId)
      .in("subject_id", enrolledSubjectIds)
      .order("created_at", { ascending: false })
      .limit(30);

    if (!preds?.length) {
      return json(req, {
        insight: "No risk analysis results yet. When your instructor runs risk analysis, personalized coaching will appear here.",
      });
    }

    const coachingSubjects = rankCoachingSubjects(
      buildLatestPerSubject(preds as PredictionRow[])
        .map((row) => mapPredictionRow(row))
        .filter((m): m is SubjectCoachingMetrics => m != null),
    );

    contextBlock = [
      "You are helping a STUDENT with academic coaching.",
      "Use ONLY the system-computed metrics below. Do not change their risk classification.",
      "Provide: weak areas, study strategies, and 2–3 improvement actions.",
      "",
      coachingSubjects.map(formatMetricsBlock).join("\n\n"),
    ].join("\n");
  }

  if (!ai) {
    console.error("ai-coach: OPENAI_API_KEY is not configured");
    return json(req, { insight: "The AI summary is unavailable right now. Please try again later." });
  }

  const system = [
    COACHING_ROLE_PROMPT,
    "Write 2 short paragraphs: first identify weak areas from the metrics, then give study strategies and improvement actions.",
  ].join("\n\n");

  try {
    const insight = await callOpenAiChat({
      apiKey: ai.apiKey,
      model: ai.model,
      system,
      messages: [{ role: "user", content: contextBlock }],
      temperature: 0.5,
      maxTokens: MAX_INSIGHT_TOKENS,
    });
    return json(req, { insight: insight.trim() || "Could not generate a summary right now. Try again later." });
  } catch (e) {
    console.error("ai-coach insight model error:", e instanceof Error ? e.name : "unknown");
    return json(req, { insight: "Could not generate a summary right now. Try again later." });
  }
}
