import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_MESSAGE_HISTORY = 12;
const MAX_OUTPUT_TOKENS = 350;
const MAX_INSIGHT_TOKENS = 500;
const MAX_MESSAGE_LENGTH = 1000;
const RATE_LIMIT_REQUESTS = 20;
const RATE_LIMIT_WINDOW = 60;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || Deno.env.get("FRONTEND_URL") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
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

function sanitizeMessage(message: string): string {
  return message
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH)
    .replace(/[<>]/g, "")
    .replace(/javascript:/gi, "")
    .replace(/data:/gi, "");
}

function validateMessage(message: unknown): string | null {
  if (typeof message !== "string") return null;
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > MAX_MESSAGE_LENGTH) return null;
  return sanitizeMessage(trimmed);
}

type CanonicalRiskLevel = "critical" | "at_risk" | "stable" | "excelling";

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

const COACHING_ROLE_PROMPT = [
  "You are an academic coaching assistant for university students.",
  "CRITICAL: You do NOT determine, change, or override student risk classification or engagement level.",
  "Risk classification, engagement level, and all performance metrics are computed by the EDGE system. Treat them as fixed facts.",
  "",
  "Your responsibilities ONLY:",
  "1. Generate personalized coaching recommendations based on the provided metrics.",
  "2. Suggest practical study strategies.",
  "3. Identify weak areas evidenced by the metrics.",
  "4. Recommend concrete improvement actions for the next 7 days.",
  "",
  "Never reassess risk level or engagement level. Never invent metrics. Never claim to be a counselor or therapist.",
  "If the user mentions self-harm, urge them to contact emergency services or a trusted person.",
  "Formatting: plain text only—no markdown, no asterisks, no bold. Use short paragraphs; use 1. 2. numbering for steps.",
  "Ask at most one question per reply.",
].join("\n");

const OUT_OF_SCOPE_COACHING_REPLY =
  "I cannot help with that topic. I can only provide academic coaching—study strategies, weak areas, and improvement actions based on your computed risk analysis results.";

function canonicalRiskLevel(level: unknown): CanonicalRiskLevel {
  if (typeof level !== "string") return "stable";
  const normalized = level.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized === "critical") return "critical";
  if (normalized === "at_risk" || normalized === "at-risk" || normalized === "atrisk") return "at_risk";
  if (normalized === "excelling") return "excelling";
  if (normalized === "stable") return "stable";
  return "stable";
}

const RISK_PRIORITY: Record<CanonicalRiskLevel, number> = {
  excelling: 0,
  stable: 1,
  at_risk: 2,
  critical: 3,
};

function createdAtTs(value: unknown): number {
  if (typeof value !== "string") return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function safeString(s: unknown): string | null {
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

type ChatMessage = { role: "user" | "assistant"; content: string };
type ApiResponse = {
  reply?: string;
  insight?: string;
  risk_level?: string;
  subject?: { code?: string | null; name?: string | null } | null;
  error?: string;
  hint?: string;
};

type ChatCompletionMessage = { role: "system" | "user" | "assistant"; content: string };

function pctFromRate(rate: number | null | undefined): number | null {
  if (rate == null || !Number.isFinite(rate)) return null;
  return rate <= 1 ? Math.round(rate * 1000) / 10 : Math.round(rate * 10) / 10;
}

function pctDirect(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

function riskStatusLabel(level: CanonicalRiskLevel): string {
  if (level === "critical") return "Crucial";
  if (level === "at_risk") return "Vulnerable";
  if (level === "excelling") return "Excelling";
  return "Stable";
}

function mapPredictionRow(row: {
  subject_id?: string | null;
  risk_level?: string | null;
  risk_score?: number | null;
  confidence?: number | null;
  attendance_rate?: number | null;
  activity_average?: number | null;
  activity_completion_rate?: number | null;
  quiz_average?: number | null;
  laboratory_exam_average?: number | null;
  comprehension_rating?: number | null;
  created_at?: string | null;
  subjects?: { code?: string | null; name?: string | null } | null;
}): SubjectCoachingMetrics | null {
  const subjectId = typeof row.subject_id === "string" ? row.subject_id : null;
  if (!subjectId) return null;

  const riskClassification = canonicalRiskLevel(row.risk_level);
  const riskScore =
    row.risk_score != null && Number.isFinite(row.risk_score)
      ? Math.round(row.risk_score * 10) / 10
      : row.confidence != null && Number.isFinite(row.confidence)
        ? Math.round(row.confidence * 1000) / 10
        : null;

  const activityScorePercent =
    pctDirect(row.activity_average) ??
    (row.activity_completion_rate != null ? pctFromRate(row.activity_completion_rate) : null);

  return {
    subjectId,
    subjectCode: row.subjects?.code ?? "Subject",
    subjectName: row.subjects?.name ?? null,
    riskClassification,
    riskScore,
    attendancePercent: pctFromRate(row.attendance_rate),
    activityScorePercent,
    quizScorePercent: pctDirect(row.quiz_average),
    laboratoryExamPercent: pctDirect(row.laboratory_exam_average),
    comprehensionRating:
      row.comprehension_rating != null && Number.isFinite(row.comprehension_rating)
        ? Math.round(row.comprehension_rating * 10) / 10
        : null,
    createdAt: row.created_at ?? null,
  };
}

function buildLatestPerSubject<T extends { subject_id?: string | null; created_at?: string | null }>(
  rows: T[],
): T[] {
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

function formatMetricsBlock(metrics: SubjectCoachingMetrics): string {
  const lines = [
    `Subject: ${metrics.subjectCode}${metrics.subjectName ? ` — ${metrics.subjectName}` : ""}`,
    `Risk classification (system-computed): ${riskStatusLabel(metrics.riskClassification)}`,
    metrics.riskScore != null ? `Risk score: ${metrics.riskScore}` : null,
    metrics.attendancePercent != null ? `Attendance: ${metrics.attendancePercent}%` : null,
    metrics.activityScorePercent != null ? `Activity scores: ${metrics.activityScorePercent}%` : null,
    metrics.quizScorePercent != null ? `Quiz scores: ${metrics.quizScorePercent}%` : null,
    metrics.laboratoryExamPercent != null ? `Laboratory exam scores: ${metrics.laboratoryExamPercent}%` : null,
    metrics.comprehensionRating != null ? `Comprehension rating: ${metrics.comprehensionRating}/5` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

type StudentEngagementContext = {
  engagementLevel: string;
  engagementScore: number | null;
  totalLoginCount: number;
  recentActivitySummary: string;
  participationHistory: string;
};

function engagementLevelLabel(level: string): string {
  const normalized = level.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized === "very_high" || normalized === "highly_active") return "Highly Active";
  if (normalized === "high" || normalized === "active") return "Active";
  if (normalized === "low" || normalized === "inactive") return "Inactive";
  return "Low Engagement";
}

function activityTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    view_material: "Viewed learning material",
    open_module: "Opened course module",
    read_announcement: "Read announcement",
    view_file: "Viewed uploaded file",
    view_subject_page: "Accessed subject page",
    view_coaching: "Viewed AI coaching",
    view_grades: "Viewed grades",
    view_attendance: "Viewed attendance",
    quiz_complete: "Completed quiz",
    assignment_submit: "Submitted assignment",
    assignment_view: "Viewed assignment",
    ai_session: "Used AI coaching",
    feedback_submit: "Submitted feedback",
    page_visit: "Visited page",
  };
  return labels[type] ?? type.replace(/_/g, " ");
}

async function fetchStudentEngagementContext(
  supabase: ReturnType<typeof createClient>,
  studentId: string,
): Promise<StudentEngagementContext | null> {
  const { data: summary } = await supabase
    .from("student_engagement_summary")
    .select("engagement_level, engagement_score, total_login_count, participation_count")
    .eq("student_id", studentId)
    .maybeSingle();

  const { data: recentActivities } = await supabase
    .from("student_activity")
    .select("activity_type, activity_description, created_at")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(8);

  if (!summary && (!recentActivities || recentActivities.length === 0)) return null;

  const recentLines = (recentActivities ?? []).slice(0, 5).map((row) => {
    const label =
      typeof row.activity_description === "string" && row.activity_description.trim()
        ? row.activity_description.trim()
        : activityTypeLabel(String(row.activity_type ?? "activity"));
    const when = typeof row.created_at === "string"
      ? new Date(row.created_at).toLocaleString()
      : "";
    return when ? `- ${label} (${when})` : `- ${label}`;
  });

  return {
    engagementLevel: engagementLevelLabel(String(summary?.engagement_level ?? "moderate")),
    engagementScore:
      summary?.engagement_score != null && Number.isFinite(summary.engagement_score)
        ? Math.round(Number(summary.engagement_score) * 10) / 10
        : null,
    totalLoginCount: Number(summary?.total_login_count ?? 0),
    recentActivitySummary: recentLines.length > 0 ? recentLines.join("\n") : "No recent activity recorded.",
    participationHistory: `Total participation events (30-day window): ${Number(summary?.participation_count ?? 0)}`,
  };
}

function formatEngagementBlock(ctx: StudentEngagementContext): string {
  return [
    "Student engagement (system-computed):",
    `Engagement level: ${ctx.engagementLevel}`,
    ctx.engagementScore != null ? `Engagement score: ${ctx.engagementScore}` : null,
    `Total login count: ${ctx.totalLoginCount}`,
    ctx.participationHistory,
    "Recent activity summary:",
    ctx.recentActivitySummary,
  ]
    .filter(Boolean)
    .join("\n");
}

async function fetchStudentCoachingSubjects(
  supabase: ReturnType<typeof createClient>,
  studentId: string,
  enrolledSubjectIds: string[],
): Promise<SubjectCoachingMetrics[]> {
  const { data: preds } = await supabase
    .from("predictions")
    .select(
      "risk_level, risk_score, confidence, attendance_rate, activity_average, activity_completion_rate, quiz_average, laboratory_exam_average, comprehension_rating, created_at, subject_id, subjects(code, name)",
    )
    .eq("student_id", studentId)
    .in("subject_id", enrolledSubjectIds)
    .order("created_at", { ascending: false })
    .limit(300);

  if (!preds?.length) return [];

  const latestRows = buildLatestPerSubject(preds as Array<{ subject_id?: string | null; created_at?: string | null }>);
  const mapped = latestRows
    .map((row) => mapPredictionRow(row as Parameters<typeof mapPredictionRow>[0]))
    .filter((m): m is SubjectCoachingMetrics => m != null);

  return rankCoachingSubjects(mapped);
}

function latestRealUserMessage(messages: ChatMessage[]): string {
  const contextPrefix = "Context (do not quote verbatim):";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user" || typeof m?.content !== "string") continue;
    const trimmed = m.content.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith(contextPrefix)) continue;
    return trimmed.toLowerCase();
  }
  return "";
}

function isAcademicRiskRelated(text: string): boolean {
  if (!text) return true;
  const academicKeywords = [
    "academic",
    "study",
    "subject",
    "course",
    "class",
    "teacher",
    "instructor",
    "attendance",
    "absent",
    "late",
    "grade",
    "score",
    "quiz",
    "exam",
    "assignment",
    "project",
    "submission",
    "risk",
    "at risk",
    "critical",
    "prediction",
    "recommendation",
    "performance",
    "improve",
    "school",
    "college",
    "university",
    "gpa",
    "pass",
    "fail",
    "failing",
    "semester",
    "review",
  ];
  return academicKeywords.some((k) => text.includes(k));
}

async function openAiChatCompletions(opts: {
  apiKey: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const payloadMessages: ChatCompletionMessage[] = [
    { role: "system", content: opts.system },
    ...opts.messages
      .filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim()
      )
      .slice(-MAX_MESSAGE_HISTORY)
      .map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content,
      })),
  ];

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: payloadMessages,
      temperature: opts.temperature ?? 0.6,
      // Some newer models use `max_completion_tokens` instead of `max_tokens`.
      max_completion_tokens: opts.maxTokens ?? MAX_OUTPUT_TOKENS,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json?.error?.message ||
      json?.message ||
      `OpenAI error (${res.status})`;
    throw new Error(String(msg));
  }

  const text = json?.choices?.[0]?.message?.content;
  return typeof text === "string" ? text.trim() : "";
}

function getOpenAiConfig(): { apiKey: string; model: string } | null {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return null;
  const model = Deno.env.get("OPENAI_MODEL") || "gpt-5.4-mini";
  return { apiKey, model };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Service configuration error");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing bearer token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({
          error: authError?.message || "Invalid authentication",
          hint:
            "Try refreshing the page or signing out and back in. Ensure this app uses the same Supabase project as the deployed ai-coach function.",
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const mode = safeString(body?.mode) || "chat";

    // --- AI insight for Performance Insights tab ---
    if (mode === "predictions_insight") {
      if (!checkRateLimit(user.id)) {
        return new Response(JSON.stringify({ error: "Too many requests. Please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const enabled = (Deno.env.get("AI_COACH_ENABLED") || "true").toLowerCase();
      if (enabled !== "true" && enabled !== "1" && enabled !== "yes") {
        return new Response(JSON.stringify({ insight: "AI insights are disabled." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const aiConfig = getOpenAiConfig();
      if (!aiConfig) {
        return new Response(
          JSON.stringify({
            error: "Set OPENAI_API_KEY in Supabase secrets.",
          }),
          {
            status: 503,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      const role = roleRow?.role;
      let contextBlock = "";

      if (role === "instructor") {
        const { data: subjects } = await supabase
          .from("subjects")
          .select("id, code, name")
          .eq("instructor_id", user.id);

        const ids = (subjects ?? []).map((s: { id: string }) => s.id).filter(Boolean);
        if (ids.length === 0) {
          return new Response(JSON.stringify({ insight: "Create subjects and run predictions to see an AI summary here." }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: predsRaw } = await supabase
          .from("predictions")
          .select(
            "risk_level, risk_score, confidence, attendance_rate, activity_average, activity_completion_rate, quiz_average, laboratory_exam_average, comprehension_rating, subject_id, student_id, subjects(code, name)",
          )
          .in("subject_id", ids)
          .order("created_at", { ascending: false })
          .limit(120);

        const { data: enrollRows } = await supabase
          .from("enrollments")
          .select("student_id, subject_id")
          .in("subject_id", ids)
          .eq("status", "active");

        const activeKeys = new Set(
          (enrollRows ?? [])
            .filter((e: { student_id?: string; subject_id?: string }) => e.student_id && e.subject_id)
            .map((e: { student_id: string; subject_id: string }) => `${e.student_id}::${e.subject_id}`),
        );

        const preds = (predsRaw ?? []).filter((p: {
          student_id?: string;
          subject_id?: string;
        }) => Boolean(p.student_id && p.subject_id && activeKeys.has(`${p.student_id}::${p.subject_id}`))).slice(0, 80);

        if (!preds?.length) {
          return new Response(
            JSON.stringify({
              insight: "No predictions yet. Run risk analysis from a subject page to see an AI summary here.",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const latestInstructorRows: Array<Parameters<typeof mapPredictionRow>[0]> = [];
        const seenStudentSubject = new Set<string>();
        for (const row of preds ?? []) {
          const sid = row.student_id as string | undefined;
          const subj = row.subject_id as string | undefined;
          if (!sid || !subj || !activeKeys.has(`${sid}::${subj}`)) continue;
          const key = `${sid}::${subj}`;
          if (seenStudentSubject.has(key)) continue;
          seenStudentSubject.add(key);
          latestInstructorRows.push(row as Parameters<typeof mapPredictionRow>[0]);
          if (latestInstructorRows.length >= 80) break;
        }
        const lines = latestInstructorRows
          .map((p) => {
            const metrics = mapPredictionRow(p as Parameters<typeof mapPredictionRow>[0]);
            return metrics ? formatMetricsBlock(metrics) : null;
          })
          .filter(Boolean);
        contextBlock = [
          "You are helping an INSTRUCTOR review class-wide risk analysis results.",
          "Do NOT reclassify students. Summarize patterns, weak areas, and coaching priorities across subjects.",
          "",
          "System-computed metrics (latest per student/subject):",
          lines.join("\n\n"),
        ].join("\n");
      } else {
        const { data: enrollRows } = await supabase
          .from("enrollments")
          .select("subject_id")
          .eq("student_id", user.id)
          .eq("status", "active");
        const enrolledSubjectIds = (enrollRows ?? [])
          .map((r: { subject_id?: string | null }) => r.subject_id)
          .filter((id: string | null): id is string => Boolean(id));
        if (enrolledSubjectIds.length === 0) {
          return new Response(
            JSON.stringify({
              insight:
                "No enrolled subjects found yet. Once you are enrolled in a course, prediction summaries can appear here after your instructor runs risk analysis.",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const { data: preds } = await supabase
          .from("predictions")
          .select(
            "risk_level, risk_score, confidence, attendance_rate, activity_average, activity_completion_rate, quiz_average, laboratory_exam_average, comprehension_rating, created_at, subject_id, subjects(code, name)",
          )
          .eq("student_id", user.id)
          .in("subject_id", enrolledSubjectIds)
          .order("created_at", { ascending: false })
          .limit(30);

        if (!preds?.length) {
          return new Response(
            JSON.stringify({
              insight:
                "No risk analysis results yet. When your instructor runs risk analysis, personalized coaching will appear here.",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const coachingSubjects = rankCoachingSubjects(
          buildLatestPerSubject(preds as Array<{ subject_id?: string | null; created_at?: string | null }>)
            .map((row) => mapPredictionRow(row as Parameters<typeof mapPredictionRow>[0]))
            .filter((m): m is SubjectCoachingMetrics => m != null),
        );

        const lines = coachingSubjects.map((m) => formatMetricsBlock(m));
        contextBlock = [
          "You are helping a STUDENT with academic coaching.",
          "Use ONLY the system-computed metrics below. Do not change their risk classification.",
          "Provide: weak areas, study strategies, and 2–3 improvement actions.",
          "",
          lines.join("\n\n"),
        ].join("\n");
      }

      const system = [
        COACHING_ROLE_PROMPT,
        "Write 2 short paragraphs: first identify weak areas from the metrics, then give study strategies and improvement actions.",
      ].join("\n\n");

      const insight = await openAiChatCompletions({
        apiKey: aiConfig.apiKey,
        model: aiConfig.model,
        system,
        messages: [{ role: "user", content: contextBlock }],
        temperature: 0.5,
        maxTokens: MAX_INSIGHT_TOKENS,
      });

      const response: ApiResponse = {
        insight: insight || "Could not generate a summary right now. Try again later.",
      };
      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- AI Coach chat ---
    if (!checkRateLimit(user.id)) {
      return new Response(JSON.stringify({ error: "Too many requests. Please try again later." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userMessage = validateMessage(body?.message);
    const messages = Array.isArray(body?.messages) ? (body.messages as ChatMessage[]) : [];

    const validMessages = messages.filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim() &&
        m.content.length <= MAX_MESSAGE_LENGTH,
    );

    const hasUserTurn = validMessages.some((m) => m.role === "user");
    const effectiveMessages: ChatMessage[] = hasUserTurn
      ? validMessages
      : userMessage
        ? [...validMessages, { role: "user", content: userMessage }]
        : validMessages;

    if (effectiveMessages.length === 0) {
      const response: ApiResponse = {
        reply:
          "Hi—I'm your study coach. Tell me which subject you want to work on and what you'd like to improve, and we'll make a short plan.",
        risk_level: "stable",
      };
      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: enrollments } = await supabase
      .from("enrollments")
      .select("subject_id")
      .eq("student_id", user.id)
      .eq("status", "active");

    const enrolledSubjectIds = (enrollments ?? [])
      .map((row: { subject_id?: string | null }) => row.subject_id ?? null)
      .filter((id: string | null): id is string => Boolean(id));

    if (enrolledSubjectIds.length === 0) {
      return new Response(
        JSON.stringify({
          reply:
            "I cannot find active enrolled subjects yet. Please confirm your enrollment with your instructor, then try again.",
          risk_level: "stable",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const coachingSubjects = await fetchStudentCoachingSubjects(supabase, user.id, enrolledSubjectIds);

    if (coachingSubjects.length === 0) {
      return new Response(
        JSON.stringify({
          reply:
            "No risk analysis results are available yet. Ask your instructor to run risk analysis so I can give targeted coaching based on your computed metrics.",
          risk_level: "stable",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const focusSubject = coachingSubjects[0];
    const risk = focusSubject.riskClassification;
    const lastUserMessage = latestRealUserMessage(effectiveMessages);
    if (!isAcademicRiskRelated(lastUserMessage)) {
      return new Response(
        JSON.stringify({
          reply: OUT_OF_SCOPE_COACHING_REPLY,
          risk_level: risk,
          subject: focusSubject.subjectCode || focusSubject.subjectName
            ? { code: focusSubject.subjectCode, name: focusSubject.subjectName }
            : null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const enabled = (Deno.env.get("AI_COACH_ENABLED") || "true").toLowerCase();
    if (enabled !== "true" && enabled !== "1" && enabled !== "yes") {
      return new Response(JSON.stringify({ reply: "The AI coach is currently disabled by the system.", risk_level: risk }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiConfig = getOpenAiConfig();
    if (!aiConfig) {
      return new Response(
        JSON.stringify({
          error: "Set OPENAI_API_KEY in Supabase secrets.",
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const prioritySubjects = coachingSubjects.filter(
      (s) => s.riskClassification === "critical" || s.riskClassification === "at_risk",
    );
    const coachingFocusSubjects = prioritySubjects.length > 0 ? prioritySubjects : coachingSubjects.slice(0, 3);

    const allSubjectContext = coachingFocusSubjects.map((m) => formatMetricsBlock(m)).join("\n\n");
    const engagementContext = await fetchStudentEngagementContext(supabase, user.id);
    const engagementBlock = engagementContext ? formatEngagementBlock(engagementContext) : null;

    const system = [
      COACHING_ROLE_PROMPT,
      "Scope limitation: only respond to academic coaching (study strategies, weak areas, improvement actions, engagement tips).",
      `If the user asks something outside this scope, reply exactly with: "${OUT_OF_SCOPE_COACHING_REPLY}"`,
      "Build on the system-computed metrics below. Do not ask the student to re-explain metrics you already have.",
      "Use engagement data only to suggest ways to improve participation and study habits—not to recalculate engagement.",
      "When multiple subjects appear, prioritize critical and vulnerable subjects first.",
      "",
      engagementBlock,
      "",
      "System-computed student metrics:",
      allSubjectContext,
    ]
      .filter(Boolean)
      .join("\n");

    const reply = await openAiChatCompletions({
      apiKey: aiConfig.apiKey,
      model: aiConfig.model,
      system,
      messages: effectiveMessages,
      temperature: 0.6,
      maxTokens: MAX_OUTPUT_TOKENS,
    });

    const finalReply =
      reply ||
      "I'm having trouble generating coaching advice right now. Please try again in a moment.";

    const recommendationText = finalReply.trim().slice(0, 2000);
    if (recommendationText) {
      const { data: latestPred } = await supabase
        .from("predictions")
        .select("id, recommendation")
        .eq("student_id", user.id)
        .eq("subject_id", focusSubject.subjectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestPred?.id && latestPred.recommendation !== recommendationText) {
        const { error: recError } = await supabase
          .from("predictions")
          .update({ recommendation: recommendationText })
          .eq("id", latestPred.id);
        if (recError) console.error("ai-coach recommendation persist:", recError);
      }
    }

    const response: ApiResponse = {
      reply: finalReply,
      risk_level: risk,
      subject: focusSubject.subjectCode || focusSubject.subjectName
        ? { code: focusSubject.subjectCode, name: focusSubject.subjectName }
        : null,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-coach error:", e);
    const message = e instanceof Error ? e.message : String(e);
    const response: ApiResponse = { error: message || "Unknown error" };
    return new Response(JSON.stringify(response), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
