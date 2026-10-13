import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runRelease } from "../_shared/final-grade-release.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Postgrest throws plain objects, not `Error`. */
function serializeError(e: unknown): string {
  if (e instanceof Error) return e.message || "Error";
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const parts = [o.message, o.details, o.hint].filter((p): p is string => typeof p === "string" && p !== "");
    if (parts.length) return typeof o.code === "string" ? `${parts.join(" — ")} (${o.code})` : parts.join(" — ");
  }
  return typeof e === "string" ? e : "Unknown error";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() || null;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let userId: string | null = null;
    if (token) {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data.user) userId = data.user.id;
    }
    const body = await req.json().catch(() => null);

    const result = await runRelease(supabase, userId, body);
    return json(result.status, result.body);
  } catch (e) {
    const message = serializeError(e);
    console.error("release-final-grades error:", message, e);
    return json(500, { error: message });
  }
});
