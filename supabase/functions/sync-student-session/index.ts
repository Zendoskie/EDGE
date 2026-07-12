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

function parseUserAgent(ua: string): { device: string; browser: string } {
  const lower = ua.toLowerCase();
  let device = "Desktop";
  if (/mobile|android|iphone|ipad|ipod/.test(lower)) device = "Mobile";
  else if (/tablet/.test(lower)) device = "Tablet";

  let browser = "Unknown";
  if (lower.includes("edg/")) browser = "Edge";
  else if (lower.includes("chrome/") && !lower.includes("chromium")) browser = "Chrome";
  else if (lower.includes("firefox/")) browser = "Firefox";
  else if (lower.includes("safari/") && !lower.includes("chrome")) browser = "Safari";
  else if (lower.includes("opera") || lower.includes("opr/")) browser = "Opera";

  return { device, browser };
}

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

async function recomputeEngagement(
  supabase: ReturnType<typeof createClient>,
  studentId: string,
): Promise<string | null> {
  const { error } = await supabase.rpc("recompute_student_engagement", {
    p_student_id: studentId,
  });
  return error?.message ?? null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "student")
      .maybeSingle();

    if (!roleRow) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: { action?: SessionAction; sessionId?: string; userAgent?: string } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const action = body.action;
    if (!action || !["resume", "heartbeat", "finalize"].includes(action)) {
      return new Response(JSON.stringify({ error: "Invalid action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const studentId = user.id;

    if (action === "resume") {
      const { data: openSession } = await supabase
        .from("student_login_history")
        .select("id")
        .eq("student_id", studentId)
        .is("logout_time", null)
        .order("login_time", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (openSession?.id) {
        return new Response(
          JSON.stringify({ ok: true, sessionId: openSession.id }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const ua = body.userAgent ?? "";
      const { device, browser } = parseUserAgent(ua);
      const forwarded = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "";
      const ipAddress = forwarded.split(",")[0]?.trim() || null;

      const { data: inserted, error: insertError } = await supabase
        .from("student_login_history")
        .insert({
          student_id: studentId,
          login_time: new Date().toISOString(),
          device,
          browser,
          ip_address: ipAddress,
          counts_as_login: false,
        })
        .select("id")
        .single();

      if (insertError) {
        return new Response(JSON.stringify({ error: insertError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const recomputeError = await recomputeEngagement(supabase, studentId);

      return new Response(
        JSON.stringify({ ok: true, sessionId: inserted.id, recomputeError }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const sessionId = body.sessionId;
    if (!sessionId) {
      return new Response(JSON.stringify({ error: "sessionId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: row, error: readError } = await supabase
      .from("student_login_history")
      .select("login_time, student_id, logout_time")
      .eq("id", sessionId)
      .eq("student_id", studentId)
      .maybeSingle();

    if (readError) {
      return new Response(JSON.stringify({ error: readError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!row) {
      return new Response(JSON.stringify({ error: "Session not found", closed: true }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (row.logout_time) {
      return new Response(
        JSON.stringify({ ok: true, closed: true, metrics: await fetchMetrics(supabase, studentId) }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!row.login_time) {
      return new Response(JSON.stringify({ error: "Invalid session row" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const start = Date.parse(row.login_time);
    if (!Number.isFinite(start)) {
      return new Response(JSON.stringify({ error: "Invalid login_time" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "heartbeat") {
      const sessionDuration = Math.max(0, Math.round((Date.now() - start) / 1000));
      const { error: updateError } = await supabase
        .from("student_login_history")
        .update({ session_duration: sessionDuration })
        .eq("id", sessionId)
        .eq("student_id", studentId)
        .is("logout_time", null);

      if (updateError) {
        return new Response(JSON.stringify({ error: updateError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const recomputeError = await recomputeEngagement(supabase, studentId);
      let metrics: EngagementMetrics;
      try {
        metrics = await fetchMetrics(supabase, studentId);
      } catch {
        metrics = {
          total_login_count: 0,
          total_time_spent_seconds: 0,
          last_login_at: null,
        };
      }

      return new Response(JSON.stringify({ ok: true, metrics, recomputeError }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // finalize
    const logoutTime = new Date().toISOString();
    const end = Date.parse(logoutTime);
    const sessionDuration = Number.isFinite(end) && end >= start
      ? Math.round((end - start) / 1000)
      : null;

    const { error: updateError } = await supabase
      .from("student_login_history")
      .update({
        logout_time: logoutTime,
        session_duration: sessionDuration,
      })
      .eq("id", sessionId)
      .eq("student_id", studentId)
      .is("logout_time", null);

    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const recomputeError = await recomputeEngagement(supabase, studentId);
    let metrics: EngagementMetrics;
    try {
      metrics = await fetchMetrics(supabase, studentId);
    } catch {
      metrics = {
        total_login_count: 0,
        total_time_spent_seconds: 0,
        last_login_at: null,
      };
    }

    return new Response(JSON.stringify({ ok: true, closed: true, metrics, recomputeError }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
