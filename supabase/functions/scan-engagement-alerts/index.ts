import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-vercel-cron",
};

/**
 * Daily automated engagement alert scan.
 * Invoked by Vercel Cron (Authorization: Bearer CRON_SECRET) or service role.
 * Runs engagement inactivity and due intervention follow-up scans, writing
 * durable inbox notifications for newly detected work.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const cronSecret = Deno.env.get("CRON_SECRET");
    const authHeader = req.headers.get("Authorization") ?? "";
    const vercelCron = req.headers.get("x-vercel-cron");

    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const authorized =
      Boolean(vercelCron) ||
      (cronSecret && bearer === cronSecret) ||
      (serviceKey && bearer === serviceKey);

    if (!authorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const db = createClient(supabaseUrl, serviceKey);

    const [
      { data: studentsScanned, error: engagementError },
      { data: followUpsDue, error: followUpError },
    ] = await Promise.all([
      db.rpc("scan_engagement_inactivity_alerts"),
      db.rpc("scan_due_intervention_followups"),
    ]);
    if (engagementError) throw engagementError;
    if (followUpError) throw followUpError;

    return new Response(
      JSON.stringify({
        success: true,
        students_scanned: studentsScanned ?? 0,
        intervention_followups_due: followUpsDue ?? 0,
        ran_at: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("scan-engagement-alerts error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
