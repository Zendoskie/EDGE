# EDGE deploy checklist (Vercel + Supabase)

Use this before every production release so invitation emails and cron jobs keep working.

## 1. Public app URL (required)

| Where | Variable | Example |
|-------|----------|---------|
| Vercel → Environment Variables | `VITE_APP_URL` | `https://edge-yc7z.vercel.app` |
| Supabase → Edge Function secrets | `APP_URL` | same as above |
| Supabase → Edge Function secrets | `FRONTEND_URL` | same as above |

**Never** set these to `http://localhost:5173` in production.

Supabase Auth → URL Configuration:
- Site URL = your Vercel domain
- Redirect URLs include `https://your-app.vercel.app/**`

## 2. Engagement daily scan (cron)

| Where | Variable / setting |
|-------|-------------------|
| Vercel | Cron job hits `/api/cron/scan-engagement` daily (see `vercel.json`) |
| Vercel + Supabase | `CRON_SECRET` (same random string in both) |
| Vercel | `SUPABASE_SERVICE_ROLE_KEY` (server-only, never `VITE_`) |
| Vercel | `VITE_SUPABASE_URL` or `SUPABASE_URL` |
| Supabase | Deploy function: `npx supabase functions deploy scan-engagement-alerts` |

## 3. Email (Brevo)

- `BREVO_API_KEY`, `BREVO_FROM` on Supabase Edge Function secrets

## 4. Smoke checks after deploy

1. Open production site (not localhost).
2. Admin → resend a staff invitation → link host must be your Vercel domain.
3. Student / instructor inbox receives durable notifications after login.
4. Optional: `curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/cron/scan-engagement`

## 5. Local development

- Local `.env` may use localhost for UI only.
- Prefer `VITE_APP_URL` pointing at production when testing invitation emails from a local admin session.
