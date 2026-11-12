import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type SessionAction = "resume" | "heartbeat" | "finalize";

type EngagementMetrics = {
  total_login_count: number;
  total_time_spent_seconds: number;
  last_login_at: string | null;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function fetchMetrics(
  supabase: ReturnType<typeof createClient>,
  studentId: string,
): Promise<EngagementMetrics> {
  const { data, error } = await supabase
    .from("student_engagement_summary")
    .select("total_login_count, total_time_spent_seconds, last_login_at")
    .eq("student_id", studentId)
    .maybeSingle();

  if (error) throw error;

  return {
    total_login_count: data?.total_login_count ?? 0,
    total_time_spent_seconds: data?.total_time_spent_seconds ?? 0,
    last_login_at: data?.last_login_at ?? null,
  };
}

/**
 * Session tracking proxy.
 *
 * The real rules live in the database (`start_student_session`,
 * `touch_student_session`), so the browser and this function can never disagree
 * about how time is credited. Each call runs as the signed-in student, so the
 * RPC's auth.uid() checks and RLS still apply.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not authenticated" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey =
      Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid or expired session" }, 401);

    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "student")
      .maybeSingle();

    if (!roleRow) return json({ ok: true, skipped: true });

    let body: { action?: SessionAction; sessionId?: string; userAgent?: string } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const action = body.action;
    if (!action || !["resume", "heartbeat", "finalize"].includes(action)) {
      return json({ error: "Invalid action" }, 400);
    }

    if (!supabaseAnonKey) {
      return json({ error: "Server is missing the anon key" }, 500);
    }

    const asStudent = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (action === "resume") {
      const { data, error } = await asStudent.rpc("start_student_session");
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, sessionId: data, recomputeError: null });
    }

    const sessionId = body.sessionId;
    if (!sessionId) return json({ error: "sessionId required" }, 400);

    const { error } = await asStudent.rpc("touch_student_session", {
      p_session_id: sessionId,
      p_mode: action,
    });

    if (error) {
      const closed = error.code === "P0002";
      return json(
        { error: error.message, closed },
        closed ? 404 : 500,
      );
    }

    if (action === "finalize") {
      let metrics: EngagementMetrics;
      try {
        metrics = await fetchMetrics(admin, user.id);
      } catch {
        metrics = { total_login_count: 0, total_time_spent_seconds: 0, last_login_at: null };
      }
      return json({ ok: true, closed: true, metrics, recomputeError: null });
    }

    return json({ ok: true, recomputeError: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ error: message }, 500);
  }
});
