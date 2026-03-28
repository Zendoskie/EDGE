# Setting up a new Supabase project (fresh account)

Use this when you've linked the codebase to a **new** Supabase project (e.g. [your project](https://supabase.com/dashboard/project/gvtvuopmybdmwfinxtou)) and need to create the database from scratch.

---

## Step 1: Apply all migrations (create tables and RLS)

You can do this in one of two ways.

### Option A: Supabase CLI (recommended)

From the project root:

```bash
npx supabase link --project-ref gvtvuopmybdmwfinxtou
npx supabase db push
```

When prompted, use your database password (from **Project Settings → Database** in the dashboard).

### Option B: SQL Editor in the Dashboard

1. Open your project: **https://supabase.com/dashboard/project/gvtvuopmybdmwfinxtou**
2. Go to **SQL Editor**.
3. Run each migration **in this order** (one block at a time, or combine into one script):

   - **Migration 1:** `supabase/migrations/20260303124018_1e0e503d-bf1b-4dcf-b418-4b3da9279f58.sql`  
     (Creates: `app_role`, `user_roles`, `profiles`, `programs`, `subjects`, `enrollments`, `attendance`, `activities`, `submissions`, `predictions`, `interventions`, RLS, triggers.)

   - **Migration 2:** `supabase/migrations/20260304001749_6e0c034b-deff-46e4-b997-ece258a78afd.sql`  
     (Users can insert own role.)

   - **Migration 3:** `supabase/migrations/20260304002811_06114d12-50f5-4d46-9466-0db0f766aa94.sql`  
     (Role trigger + backfill. The `INSERT` for existing users is safe if there are no users yet.)

   - **Migration 4:** `supabase/migrations/20260305000000_student_enrollment_policies.sql`  
     (Student enroll/leave + profile insert.)

   - **Migration 5:** `supabase/migrations/20260305000001_fix_predictions_and_activities_checks.sql`  
     (Allows AI prediction values and `exam` activity type.)

Copy the contents of each file and run them in the SQL Editor in the order above.

---

## Step 2: Point the app at the new project

1. In the dashboard go to **Project Settings → API**.
2. Copy:
   - **Project URL** → use as `VITE_SUPABASE_URL`
   - **anon public** key → use as `VITE_SUPABASE_PUBLISHABLE_KEY`
3. In your repo, create or edit `.env` (or `.env.local`) in the project root:

```env
VITE_SUPABASE_URL=https://gvtvuopmybdmwfinxtou.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_key_here
```

4. Restart the dev server (`npm run dev`) so it picks up the new env.

---

## Step 3: Deploy the Edge Function (for risk predictions)

The **predict-risk** function runs rule-based risk classification (no external AI or API keys needed).

1. Log in and link (if not already):

   ```bash
   npx supabase login
   npx supabase link --project-ref gvtvuopmybdmwfinxtou
   ```

2. Deploy the function:

   ```bash
   npx supabase functions deploy predict-risk
   ```

After this, “Generate Predictions” in the app will use the new project’s function.

---

## Step 4 (Optional): Automatic email notifications (Brevo)

EDGE can automatically email students when they are flagged as **Critical** or **At Risk** during prediction generation, using **Brevo** as the email provider.

1. In your Brevo account:
   - Create an API key (under **SMTP & API → API keys**).
   - Add and verify a sender email (e.g. your Gmail or a future `noreply@yourdomain.com`).

2. Deploy the functions:

```bash
npx supabase functions deploy predict-risk
npx supabase functions deploy send-notification
```

3. Set the Brevo API key (Supabase secrets):

```bash
npx supabase secrets set BREVO_API_KEY=your_brevo_api_key --env prod
```

4. Set a verified sender and update secrets (must match a verified Brevo sender):

```bash
npx supabase secrets set BREVO_FROM="EDGE <youremail@example.com>" --env prod
```

Notes:
- For best deliverability, use a sender email that is verified in Brevo (and ideally on a domain you control).

---

## Step 4B (Optional): AI via OpenAI (AI Coach + Performance Insights)

The **`ai-coach`** Edge Function powers:

- **AI Coach** popup (student dashboard / insights) when the latest prediction is **Critical** or **At Risk**
- **AI insight** on **Performance Insights → AI Predictions** (student + instructor)

### 1) OpenAI API key

Create a key at [OpenAI](https://platform.openai.com/).

### 2) Supabase secrets (do not put the key in `VITE_*` env vars)

```bash
npx supabase secrets set OPENAI_API_KEY=sk-YOUR_KEY --env prod
# Optional (defaults to gpt-5.4-mini in the Edge Function)
npx supabase secrets set OPENAI_MODEL=gpt-5.4-mini --env prod
```

Optional:

```bash
npx supabase secrets set FRONTEND_URL=http://localhost:5173 --env prod
npx supabase secrets set AI_COACH_ENABLED=true --env prod
```

### 3) Deploy

```bash
npx supabase functions deploy ai-coach
```

Notes:
- The AI coach chat only responds when the student is `critical` or `at_risk` (latest `predictions` row).
- If you see **Invalid JWT**, refresh the page or sign out/in; ensure `.env` points at the same Supabase project where `ai-coach` is deployed.

---

## Step 4b: In-app notification bell (Realtime)

The dashboard bell listens for **database changes** on the student’s own rows. Supabase only sends those events if the tables are part of the **`supabase_realtime` publication** and your **RLS policies** let the student `SELECT` the rows that changed.

### Apply the Realtime migration

From the repo root (linked project):

```bash
npx supabase db push
```

That applies `supabase/migrations/20260328000001_realtime_student_notifications.sql`, which runs:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.submissions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.predictions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance;
```

If a line errors with “already member of publication”, that table is already enabled; continue with the rest.

### Or run SQL in the Dashboard

1. Open **SQL Editor** for your project.
2. Paste and run the three `ALTER PUBLICATION` lines above (one at a time if needed).

### Dashboard check (optional)

In some projects you can confirm under **Database → Publications** (or **Replication**) that `submissions`, `predictions`, and `attendance` are included in **`supabase_realtime`**.

### What instructor actions trigger a notification

| Table | When | Student sees (in the bell panel) |
|--------|------|----------------------------------|
| `submissions` | Instructor grades or updates a grade | “New grade posted” / “Grade updated” |
| `attendance` | Instructor records attendance for that student | “Attendance recorded” (date + status) |
| `predictions` | A new prediction row is inserted for that student | “Academic insight updated” |

The student must be **logged in** with the app open (or the tab loaded); events are not emailed.

### If nothing appears

1. Confirm migrations ran and the three tables are in `supabase_realtime`.
2. Confirm RLS allows the student to read their own rows in those tables (your existing policies usually do).
3. In the browser devtools **Network** tab, confirm the WebSocket to Supabase connects after login.

---

## Step 5: Create your first users

1. Open the app (e.g. `http://localhost:5173`).
2. Use **Sign Up** to create:
   - One **Instructor** account (choose “Instructor” at signup).
   - One or more **Student** accounts (choose “Student” at signup).
3. The triggers will create `profiles` and `user_roles` for each new user.

---

## Checklist

- [ ] All migrations run without errors (tables + RLS + triggers + optional Realtime publication for the notification bell).
- [ ] `.env` has `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for the new project.
- [ ] Edge function `predict-risk` is deployed (no API keys required).
- [ ] At least one instructor and one student account created and able to log in.

If you use the CLI, run `npx supabase db push` and then deploy the functions. If you use the SQL Editor, run the migration files in order, then follow Steps 2–5.
