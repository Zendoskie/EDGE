import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type CanonicalRiskLevel = "critical" | "at_risk" | "stable" | "excelling";

function canonicalRiskLevel(level: unknown): CanonicalRiskLevel {
  if (typeof level !== "string") return "stable";
  const normalized = level.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized === "critical") return "critical";
  if (normalized === "at_risk" || normalized === "at-risk" || normalized === "atrisk") return "at_risk";
  if (normalized === "excelling") return "excelling";
  if (normalized === "stable") return "stable";
  // Back-compat for older schema values like "At Risk"
  if (normalized === "at_risk") return "at_risk";
  return "stable";
}

function safeString(s: unknown): string | null {
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

type ChatMessage = { role: "user" | "assistant"; content: string };

function toGeminiContents(messages: ChatMessage[]) {
  return messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-12)
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
}) {
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
        maxOutputTokens: 350,
      },
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json && (json.error?.message || json.message)) ? (json.error?.message || json.message) : `Gemini error (${res.status})`;
    throw new Error(msg);
  }

  const parts: Array<{ text?: string }> = json?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p?.text).filter((t): t is string => typeof t === "string" && !!t.trim()).join("");
  return (typeof text === "string" ? text.trim() : "") || "I’m here with you. What feels hardest right now—attendance, missing work, or understanding the lessons?";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");

    const body = await req.json().catch(() => ({}));
    const userMessage = safeString(body?.message);
    const messages = Array.isArray(body?.messages) ? (body.messages as ChatMessage[]) : [];

    const hasUserTurn = messages.some((m) => m?.role === "user" && typeof m?.content === "string" && m.content.trim());
    const effectiveMessages: ChatMessage[] = hasUserTurn
      ? messages
      : userMessage
        ? [...messages, { role: "user", content: userMessage }]
        : messages;

    if (effectiveMessages.length === 0) {
      return new Response(JSON.stringify({ reply: "Hi—I'm your study coach. What’s going on this week and what subject feels toughest right now?" }), {
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
      return new Response(JSON.stringify({
        reply: "The AI coach is currently disabled by the system.",
        risk_level: risk,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY secret");

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

    return new Response(JSON.stringify({
      reply,
      risk_level: risk,
      subject: subjectCode || subjectName ? { code: subjectCode, name: subjectName } : null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("ai-coach error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

