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

        const { data: preds } = await supabase
          .from("predictions")
          .select("risk_level, recommendation, subject_id, subjects(code, name)")
          .in("subject_id", ids)
          .order("created_at", { ascending: false })
          .limit(80);

        if (!preds?.length) {
          return new Response(
            JSON.stringify({
              insight: "No predictions yet. Run risk analysis from a subject page to see an AI summary here.",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const lines = (preds ?? []).map((p: {
          risk_level?: string;
          recommendation?: string | null;
          subjects?: { code?: string; name?: string | null } | null;
        }) => {
          const code = p.subjects?.code ?? "?";
          const rl = canonicalRiskLevel(p.risk_level);
          const rec = p.recommendation ? ` Rec: ${String(p.recommendation).slice(0, 120)}` : "";
          return `- ${code}: ${rl}${rec}`;
        });
        contextBlock = `You are helping an INSTRUCTOR. Summarize patterns across recent student risk predictions (do not use individual student names).\n\nData:\n${lines.join("\n")}`;
      } else {
        const { data: preds } = await supabase
          .from("predictions")
          .select("risk_level, recommendation, created_at, subjects(code, name)")
          .eq("student_id", user.id)
          .order("created_at", { ascending: false })
          .limit(30);

        if (!preds?.length) {
          return new Response(
            JSON.stringify({
              insight: "No predictions yet. When your instructor runs risk analysis, an AI summary will appear here.",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const lines = preds.map((p: {
          risk_level?: string;
          recommendation?: string | null;
          subjects?: { code?: string; name?: string | null } | null;
        }) => {
          const code = p.subjects?.code ?? "?";
          const rl = canonicalRiskLevel(p.risk_level);
          const rec = p.recommendation ? ` ${String(p.recommendation).slice(0, 200)}` : "";
          return `- ${code}: ${rl}.${rec}`;
        });
        contextBlock = `You are helping a STUDENT. Give supportive, practical guidance (2 short paragraphs max) based on these per-subject predictions:\n\n${lines.join("\n")}`;
      }

      const system =
        "You are an academic success assistant. Be concise, supportive, and actionable. Do not claim to be a therapist. Do not invent data not in the context. Write plain sentences and short paragraphs only: no markdown, no asterisks, no bold markers, and no bullet punctuation—use numbers (1. 2.) if you need an ordered list.";

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

    const { data: preds } = await supabase
      .from("predictions")
      .select("risk_level, recommendation, created_at, subject_id, subjects(code, name)")
      .eq("student_id", user.id)
      .in("subject_id", enrolledSubjectIds)
      .order("created_at", { ascending: false })
      .limit(300);

    if (!preds?.length) {
      return new Response(
        JSON.stringify({
          reply:
            "No subject risk predictions are available yet. Ask your instructor to run risk analysis so I can give targeted help.",
          risk_level: "stable",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const latestPerSubject = new Map<string, (typeof preds)[number]>();
    for (const row of preds) {
      const subjectId = row.subject_id;
      if (!subjectId || latestPerSubject.has(subjectId)) continue;
      latestPerSubject.set(subjectId, row);
    }

    const subjectPredictions = Array.from(latestPerSubject.values());
    subjectPredictions.sort((a, b) => {
      const pa = RISK_PRIORITY[canonicalRiskLevel(a.risk_level)];
      const pb = RISK_PRIORITY[canonicalRiskLevel(b.risk_level)];
      if (pa !== pb) return pb - pa;
      return createdAtTs(b.created_at) - createdAtTs(a.created_at);
    });

    const topPrediction = subjectPredictions[0];
    const risk = canonicalRiskLevel(topPrediction?.risk_level);
    if (risk !== "critical" && risk !== "at_risk") {
      return new Response(
        JSON.stringify({
          reply:
            "You’re not currently flagged as at-risk. If you still want help, tell me the subject and what you’re struggling with (time, attendance, or understanding).",
          risk_level: risk,
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

    const topAtRiskSubjects = subjectPredictions.filter((p) => {
      const level = canonicalRiskLevel(p.risk_level);
      return level === "critical" || level === "at_risk";
    });
    const coachingFocusSubjects = topAtRiskSubjects.length > 0 ? topAtRiskSubjects : subjectPredictions.slice(0, 3);

    const subjectCode = topPrediction?.subjects?.code ?? null;
    const subjectName = topPrediction?.subjects?.name ?? null;
    const recommendation = safeString(topPrediction?.recommendation);
    const allSubjectContext = coachingFocusSubjects
      .map((p) => {
        const code = p.subjects?.code ?? "Subject";
        const name = p.subjects?.name ? ` — ${p.subjects.name}` : "";
        const level = canonicalRiskLevel(p.risk_level);
        const rec = safeString(p.recommendation);
        return `${code}${name} | ${level}${rec ? ` | ${rec}` : ""}`;
      })
      .join("\n");

    const system = [
      "You are an academic support coach for university students.",
      "Goal: help at-risk students take concrete next steps in the next 7 days across all their enrolled subjects.",
      "Style: empathetic, supportive, concise, and action-oriented.",
      "Formatting: plain text only—no markdown, no asterisks or star bullets, no **bold**. Use short paragraphs; use 1. 2. numbering if steps are needed.",
      "Do NOT mention internal systems or that you are an AI model.",
      "Do NOT claim to be a counselor or therapist. If user mentions self-harm, urge them to contact emergency services or a trusted person.",
      "Ask at most one question per reply.",
      "The student's risk levels and recommendations are already known—do NOT open by asking them to choose among attendance, missing work, or understanding lessons as if the problem were unknown. Build on the recommendations and conversation.",
      "When multiple subjects appear, prioritize critical and at-risk subjects first. Do not ignore a failing subject just because another subject is stable.",
      "",
      `Student is flagged as: ${risk === "critical" ? "CRITICAL" : "AT RISK"}.`,
      subjectCode || subjectName ? `Subject: ${[subjectCode, subjectName].filter(Boolean).join(" — ")}` : "",
      recommendation ? `System recommendation: ${recommendation}` : "",
      allSubjectContext ? `Cross-subject context (latest per enrolled subject):\n${allSubjectContext}` : "",
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
      (recommendation
        ? `I'm having trouble responding right now. Your record highlights: ${recommendation.slice(0, 280)}${recommendation.length > 280 ? "…" : ""} Please try again in a moment.`
        : "I'm having trouble responding right now. Please try again in a moment.");

    const response: ApiResponse = {
      reply: finalReply,
      risk_level: risk,
      subject: subjectCode || subjectName ? { code: subjectCode, name: subjectName } : null,
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
