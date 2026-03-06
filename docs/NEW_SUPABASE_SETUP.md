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

## Step 4 (Optional): Email notifications (no API keys)

EDGE can open a pre-filled email draft to notify students (uses their profile email and your default mail app / Gmail).
This requires **no email API keys** and works immediately, but the instructor must click **Send** in their email client.

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
