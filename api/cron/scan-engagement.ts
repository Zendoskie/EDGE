/**
 * Vercel Cron entry → Supabase Edge Function scan-engagement-alerts.
 * Deployed as an API route so vercel.json crons have a stable path.
 * Set CRON_SECRET in Vercel and Supabase secrets to the same value.
 */
export const config = {
  runtime: "edge",
};

export default async function handler(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = Boolean(req.headers.get("x-vercel-cron"));

  if (cronSecret && auth !== `Bearer ${cronSecret}` && !isVercelCron) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/scan-engagement-alerts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
      "x-vercel-cron": "1",
    },
    body: "{}",
  });

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
