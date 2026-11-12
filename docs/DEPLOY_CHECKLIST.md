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

## 3. Email (Brevo — application notifications)

- `BREVO_API_KEY`, `BREVO_FROM` on Supabase Edge Function secrets (server-side only)
- Example sender: `EDGE <modsmoderator123@gmail.com>` (name and address must match your verified Brevo sender)
- `EDGE_RISK_EMAILS_ENABLED`: automatic risk emails from `predict-risk`. Off unless set to exactly `true`
  (see `docs/NEW_SUPABASE_SETUP.md`, Brevo step 4).
- Supabase **Auth** SMTP (password reset, etc.) is configured separately in the dashboard; application email uses the Brevo HTTP API, not Auth SMTP.

## 4. Smoke checks after deploy

1. Open production site (not localhost).
2. Admin → resend a staff invitation → link host must be your Vercel domain.
3. Student / instructor inbox receives durable notifications after login.
4. Optional: `curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/cron/scan-engagement`

## 5. Local development

- Local `.env` may use localhost for UI only.
- Prefer `VITE_APP_URL` pointing at production when testing invitation emails from a local admin session.

## 6. Engagement time accuracy (required for the period filters)

Applied on the linked project (versions `20261110130000`, `20261110131500`, `20261110132000`). For a new environment, apply all three in order.

- `supabase db push` fails on this project with `permission denied to alter role "cli_login_postgres"` when initialising its login role. Apply SQL through the Management API instead:

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/apply-supabase-sql.ps1 -File supabase/migrations/<file>.sql
  ```

  The script uses `SUPABASE_ACCESS_TOKEN` when set, otherwise the token stored by `supabase login`, runs the file in one transaction, and records the migration version. It is the same endpoint as the dashboard SQL editor.
- The migration adds `student_login_history.active_seconds` / `last_heartbeat_at`, `student_daily_time`, `parent_student_views`, the session RPCs (`start_student_session`, `touch_student_session`, `get_student_time_spent`, `record_parent_student_view`), and rewrites `recompute_student_engagement_internal` to use measured active time.
- Unverifiable pre-fix wall-clock time is reset to zero (not estimated); logins, activity, submissions, AI sessions, and feedback history remain.
- Redeploy the session functions after the migration: `npx supabase functions deploy sync-student-session track-student-login`.
- Smoke check as a student: sign in, stay on one page for two minutes, then run `select * from public.get_student_time_spent('<student-uuid>');` — `today_seconds` should be about 120, not the whole time the tab was open.
- Parents: open Parent Performance once; a `parent_student_views` row should appear and the parent check-in card should show a score.

