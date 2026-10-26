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
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "").trim() || null;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let userId: string | null = null;
    if (token) {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data.user) userId = data.user.id;
      // getUser requires a live session row. A still-valid access token can 403 with
      // session_not_found while PostgREST accepts it, so the gradebook loads and this button 401s.
      if (!userId) {
        const auth = supabase.auth as {
          getClaims?: (jwt: string) => Promise<{ data: { claims?: { sub?: string } } | null; error: unknown }>;
        };
        const claims = await auth.getClaims?.(token);
        const sub = claims?.data?.claims?.sub;
        if (claims && !claims.error && typeof sub === "string" && sub) userId = sub;
      }
    }
    const body = await req.json().catch(() => null);

    const result = await runRelease(supabase, userId, body);
    if (result.status === 200 && authHeader) {
      const released = (result.body as { newly_released?: Array<{ student_id: string; final_grade: number }> })
        .newly_released;
      const subjectId = (result.body as { subject_id?: string }).subject_id;
      if (released?.length && subjectId) {
        const notifyRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification`, {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            event: "final_grade_released",
            subject_id: subjectId,
            releases: released,
          }),
        });
        if (!notifyRes.ok) {
          console.error("final_grade_released notification failed:", await notifyRes.text().catch(() => ""));
        }
      }
    }
    return json(result.status, result.body);
  } catch (e) {
    const message = serializeError(e);
    console.error("release-final-grades error:", message, e);
    return json(500, { error: message });
  }
});
