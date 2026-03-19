import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Constants
const MAX_MESSAGE_HISTORY = 12;
const MAX_OUTPUT_TOKENS = 350;
const MAX_MESSAGE_LENGTH = 1000;
const RATE_LIMIT_REQUESTS = 10;
const RATE_LIMIT_WINDOW = 60; // seconds

// Simple in-memory rate limiting (for production, use Redis or similar)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function getCorsHeaders(): Record<string, string> {
  const origin = Deno.env.get("FRONTEND_URL") || "http://localhost:3000";
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
  
  if (userLimit.count >= RATE_LIMIT_REQUESTS) {
    return false;
  }
  
  userLimit.count++;
  return true;
}

function sanitizeMessage(message: string): string {
  return message
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH)
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/data:/gi, '');
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

function safeString(s: unknown): string | null {
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

type ChatMessage = { role: "user" | "assistant"; content: string };
type ApiResponse = { reply?: string; risk_level?: string; subject?: { code?: string | null; name?: string | null } | null; error?: string };

function toGeminiContents(messages: ChatMessage[]) {
  return messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_MESSAGE_HISTORY)
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
}

async function geminiReply(opts: {
  apiKey: string;
  system: string;
  messages: ChatMessage[];
  temperature?: number;
}): Promise<string> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${encodeURIComponent(opts.apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: toGeminiContents(opts.messages),
      generationConfig: {
        temperature: opts.temperature ?? 0.6,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      },
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json && (json.error?.message || json.message)) ? (json.error?.message || json.message) : `AI service error (${res.status})`;
    throw new Error(msg);
  }

  const parts: Array<{ text?: string }> = json?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p?.text).filter((t): t is string => typeof t === "string" && !!t.trim()).join("");
  return (typeof text === "string" ? text.trim() : "") || "I'm here to help. What feels hardest right now—attendance, missing work, or understanding the lessons?";
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders();
  
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

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid authentication" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limiting
    if (!checkRateLimit(user.id)) {
      return new Response(JSON.stringify({ error: "Too many requests. Please try again later." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const userMessage = validateMessage(body?.message);
    const messages = Array.isArray(body?.messages) ? (body.messages as ChatMessage[]) : [];

    // Validate messages array
    const validMessages = messages.filter(m => 
      m && 
      (m.role === "user" || m.role === "assistant") && 
      typeof m.content === "string" && 
      m.content.trim() && 
      m.content.length <= MAX_MESSAGE_LENGTH
    );

    const hasUserTurn = validMessages.some((m) => m.role === "user");
    const effectiveMessages: ChatMessage[] = hasUserTurn
      ? validMessages
      : userMessage
        ? [...validMessages, { role: "user", content: userMessage }]
        : validMessages;

    if (effectiveMessages.length === 0) {
      const response: ApiResponse = {
        reply: "Hi—I'm your study coach. What's going on this week and what subject feels toughest right now?",
        risk_level: "stable"
      };
      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Latest prediction for gating + context
    const { data: pred } = await supabase
      .from("predictions")
      .select("risk_level, recommendation, created_at, subject_id, subjects(code, name)")
      .eq("student_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const risk = canonicalRiskLevel(pred?.risk_level);
    if (risk !== "critical" && risk !== "at_risk") {
      return new Response(JSON.stringify({
        reply: "You’re not currently flagged as at-risk. If you still want help, tell me the subject and what you’re struggling with (time, attendance, or understanding).",
        risk_level: risk,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const enabled = (Deno.env.get("AI_COACH_ENABLED") || "true").toLowerCase();
    if (enabled !== "true" && enabled !== "1" && enabled !== "yes") {
      const response: ApiResponse = {
        reply: "The AI coach is currently disabled by the system.",
        risk_level: risk
      };
      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "AI service temporarily unavailable" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const subjectCode = pred?.subjects?.code ?? null;
    const subjectName = pred?.subjects?.name ?? null;
    const recommendation = safeString(pred?.recommendation);

    const system = [
      "You are an academic support coach chatbot for university students.",
      "Goal: help at-risk students take concrete next steps in the next 7 days.",
      "Style: empathetic, supportive, concise, and action-oriented.",
      "Do NOT mention any internal system names, databases, or that you are an AI model.",
      "Do NOT claim to be a counselor or therapist. If user mentions self-harm, urge them to contact local emergency services or a trusted person immediately.",
      "Ask at most one question per reply.",
      "",
      `Student is flagged as: ${risk === "critical" ? "CRITICAL" : "AT RISK"}.`,
      subjectCode || subjectName ? `Subject: ${[subjectCode, subjectName].filter(Boolean).join(" — ")}` : "",
      recommendation ? `System recommendation: ${recommendation}` : "",
    ].filter(Boolean).join("\n");

    const reply = await geminiReply({ apiKey, system, messages: effectiveMessages, temperature: 0.6 });

    const response: ApiResponse = {
      reply,
      risk_level: risk,
      subject: subjectCode || subjectName ? { code: subjectCode, name: subjectName } : null,
    };
    
    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-coach error:", e);
    const response: ApiResponse = {
      error: e instanceof Error ? "Service temporarily unavailable" : "Unknown error occurred"
    };
    return new Response(JSON.stringify(response), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

