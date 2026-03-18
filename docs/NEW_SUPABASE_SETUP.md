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

## Step 4B (Optional): AI Coach popup for at-risk students (Gemini)

EDGE can show an **AI Coach** popup in the student dashboard/insights when the latest risk prediction is **Critical** or **At Risk**.

1. Create a Gemini API key (Google AI Studio).

2. Deploy the Edge Function:

```bash
npx supabase functions deploy ai-coach
```

3. Set secrets (Supabase secrets):

```bash
npx supabase secrets set GEMINI_API_KEY=your_gemini_key --env prod
```

Optional toggle (defaults to enabled):

```bash
npx supabase secrets set AI_COACH_ENABLED=true --env prod
```

Notes:
- The AI coach only responds when the student is currently flagged as `critical` or `at_risk` (based on the latest row in `predictions`).
- If you rotate keys, update `GEMINI_API_KEY` and re-try; no code changes needed.

---

## Step 5: Create your first users

1. Open the app (e.g. `http://localhost:5173`).
2. Use **Sign Up** to create:
   - One **Instructor** account (choose “Instructor” at signup).
   - One or more **Student** accounts (choose “Student” at signup).
3. The triggers will create `profiles` and `user_roles` for each new user.

---

## Checklist

- [ ] All 5 migrations run without errors (tables + RLS + triggers).
- [ ] `.env` has `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for the new project.
- [ ] Edge function `predict-risk` is deployed (no API keys required).
- [ ] At least one instructor and one student account created and able to log in.

If you use the CLI, run `npx supabase db push` and then deploy the functions. If you use the SQL Editor, run the migration files in order, then follow Steps 2–5.
