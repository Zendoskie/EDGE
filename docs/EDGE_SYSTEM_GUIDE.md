# EDGE System Guide

This guide documents **implemented behavior** in the EDGE (Student Risk Analysis and AI Coaching System) codebase as of branch `test/edge-round2-2-1-20261021`. It is written for capstone panel review, operators, and maintainers.

For formal disclaimer language used in the research paper and UI, see [ACADEMIC_DISCLAIMER.md](./ACADEMIC_DISCLAIMER.md). For deployment and email secrets, see [DEPLOY_CHECKLIST.md](./DEPLOY_CHECKLIST.md) and [NEW_SUPABASE_SETUP.md](./NEW_SUPABASE_SETUP.md).

**Evidence basis:** Application code under `src/`, Edge Functions under `supabase/functions/`, SQL migrations under `supabase/migrations/`, and Vitest tests cited inline. Behavior that depends on a deployed migration, Edge Function, or environment secret is labeled as a **deployment dependency**.

---

## 1. System users and permissions

EDGE uses Supabase Auth with role rows in `public.user_roles` (`app_role`: `student`, `instructor`, `parent`, `admin`, `guidance_counselor`). Row Level Security (RLS) and security-definer RPCs enforce access. The matrix below summarizes **repository-evidenced** behavior; live production policy drift is possible if migrations were not applied.

| Role | Primary dashboards / features | Data access (summary) | Approvals / limits |
|------|------------------------------|------------------------|-------------------|
| **Student** | Student dashboard, subjects, gradebook view (own), Performance Insights, AI Coach, AI Recommendations, feedback submission, parent access requests | Own profile, enrollments, submissions, attendance, predictions, inbox notifications (`user_id = auth.uid()`). Cannot read other students’ records. | Approves or rejects parent link requests (`student_decide_parent_request`); cannot grant parent access without admin second step. |
| **Instructor** | Instructor dashboard, subject detail, gradebook (save grades), attendance, enrollment decisions, early warnings, referrals, feedback replies, reports | Manages submissions/activities for subjects they teach (`has_role(instructor)` policies). Views enrolled students’ performance for owned subjects. | Approves/rejects enrollment requests; enters grades and attendance manually. |
| **Parent / guardian** | Parent performance dashboard (after approval) | **Only** when `parent_student_links.status = 'approved'`: RLS policies allow read of linked student attendance, enrollments, submissions, predictions, interventions, engagement summary, etc. (`20261002100100_parent_two_step_verification.sql`). | Two-step link: student approval → `pending_admin` → administrator approval → `approved`. Cannot view data while `pending` or `rejected`. |
| **Administrator** | Admin approvals, user management, staff invitations, registration review, parent link final approval | Broad staff tools; RPCs such as `admin_decide_parent_request`, `admin_review_student_request`, account status. | Rejects/approves registrations; final parent-link gate; does not automatically bypass student consent for parent access. |
| **Guidance counselor** | Guidance referrals, engagement views, counselor inbox | Policies reference `has_role(..., 'guidance_counselor')` for referrals, engagement summaries, and related student profiles (see migrations e.g. `20260831115504`, `20261005220000`). | Acts on referrals and engagement workflows; does not replace instructor grade entry. |

### Parent linking (two-step)

Documented in `20261002100100_parent_two_step_verification.sql`:

1. Parent requests link (`parent_request_student_link`) or registers as parent → status `pending`.
2. Student approves → `pending_admin` (student must not skip admin).
3. Administrator approves → `approved` (parent may access linked student data per RLS).

Statuses include `rejected` (student) and `admin_rejected` (administrator). Dashboard notifications are written by database triggers (`notify_parent_link_status_change`); emails use `send-parent-email` and related Edge paths (**deployment dependency**: Brevo secrets).

### Permissions not fully enumerable here

A complete RLS listing would require reading every migration policy. If a capability is not listed above, treat it as **unverified** until confirmed in SQL and UI routes.

---

## 2. Academic risk classification (operational definitions)

### 2.1 Display labels vs stored values

| Stored value (`predictions.risk_level`, etc.) | User-facing label (`riskLabel` in `src/lib/risk-utils.ts`) |
|-----------------------------------------------|------------------------------------------------------------|
| `excelling` | **Excelling** |
| `stable` | **Stable** |
| `at_risk` | **Vulnerable** |
| `critical` | **Crucial** |

Documentation and UI use the right-hand labels. Database and Edge code may still use legacy enum strings; **do not rename schema values** for documentation alone.

### 2.2 Core score and bands

Classification is driven by a **subject weighted grade percentage** (two-decimal), not by AI Coaching.

Official bands (`RISK_BANDS` in `src/lib/risk-scoring.ts`, parity-tested with `supabase/functions/_shared/risk-scoring.ts`):

| Label (display) | Condition on weighted `risk_score` (after `roundGrade2`) |
|-----------------|----------------------------------------------------------|
| Excelling | score ≥ **90** |
| Stable | **80** ≤ score &lt; 90 |
| Vulnerable | **75** ≤ score &lt; 80 |
| Crucial | score &lt; **75** |
| Stable (fallback) | score is `null` or non-finite → `classifyRiskScore` returns `stable` |

Examples from tests (`src/lib/risk-scoring.test.ts`): 90 → Excelling; 89.99 → Stable; 75 → Vulnerable; 74.99 → Crucial.

Rounding: `roundGrade2` uses half-up style at two decimals (e.g. 89.995 → 90.00), which can move a student across a band.

### 2.3 How the weighted score is built

Per subject (`computeSubjectWeightedGrade` in `src/lib/weighted-grading.ts`):

1. Each assessment score is converted to a **percentage** of max score (`assessmentPercent`). **Missing score (`null`) is omitted**; **zero is a valid grade**.
2. Assessments are grouped into categories by type:
   - **Activities** (coursework types)
   - **Projects**
   - **Exams** (midterm-side and final exam averages combined via `computeExamAverage`)
3. **Attendance** enters as a percentage when recorded.
4. Category averages are combined with **subject-specific weights** from `subject_grading_systems`, or defaults:

   | Category | Default weight (%) |
   |----------|-------------------|
   | Activity | 25 |
   | Project | 25 |
   | Attendance | 15 |
   | Exam | 35 |

5. `computeWeightedGrade` includes **only categories that have data** and renormalizes over their weights (partial data does not treat missing categories as zero).

**Institution note:** Instructors can configure per-subject weights when the product saves a `subject_grading_systems` row. Documented defaults are not a universal institutional policy.

### 2.4 Evidence and display status

Risk **classification** can be stored while evidence is incomplete. `riskDisplayStatus` (`src/lib/risk-scoring.ts`) qualifies the UI:

- **confirmed** — every weighted category has evidence (`predictionCoverage`).
- **provisional** — missing evidence in one or more weighted categories; label may change when data arrives.
- **insufficient** — no weighted grade.
- **unverified** — view did not load evidence columns.

**Assignment completion (stored, not banding):** `predict-risk` computes `activity_completion_rate` as the share of subject activities with a **non-null** submission score (`completedActivities / totalActivities`) and stores it on `predictions`. That rate is **not** an input to `classifyStudentRisk` / `classifyRiskScore`; bands use weighted grade percentages only.

**Engagement:** Separate engagement summaries and cron-driven scans (`scan-engagement`, see deploy checklist) can drive inbox alerts and counselor views. They are **not** substitutes for the four-band classification unless a future migration explicitly wires them in (not evidenced for banding today).

**Student feedback:** `comprehension_rating` is derived in `predict-risk` from quiz/activity averages and recent feedback reasons; it is stored on predictions and may inform recommendation text, but it does **not** change the 90/80/75 thresholds.

### 2.5 When classification is calculated or refreshed

- **`predict-risk` Edge Function** recomputes and persists predictions (invoked from the client via `recalculateSubjectRisk` in `src/lib/recalculate-risk.ts`), e.g. after instructor grade save in `GradebookTable`.
- **Not** recalculated on every dashboard render; triggered by explicit recalculation paths and data changes that call `predict-risk`.

### 2.6 Where results appear

- Student Performance Insights / subject views (with disclaimer components).
- Instructor subject prediction tables.
- Parent performance (approved link only).
- Reports (`Reports.tsx`, `EnhancedReports.tsx`).

### 2.7 Risk classification vs AI Coaching

- **Risk level and score** are computed by `predict-risk` and shared risk-scoring logic.
- **AI Coach** (`ai-coach` Edge Function) may *read* risk context for coaching but does **not** assign official risk bands.
- **Study recommendations** on the AI Recommendations page use database heuristics (`sync_learning_recommendations_for_student`), not the coach model (see Section 6).

Automatic **risk emails** to students are **off by default** unless `EDGE_RISK_EMAILS_ENABLED=true` on the project (`supabase/functions/_shared/risk-email.ts`). When enabled, email is limited to definitive Vulnerable/Crucial results with complete evidence.

---

## 3. Grading, missing data, and performance reports

### 3.1 Assessment types and grade entry

Instructors enter scores in the gradebook (`GradebookTable.tsx`). Supported assessment types are defined in `src/lib/assessment-types.ts` (activities, projects, quizzes, midterm/final exams, etc.). Only **changed** cells are saved (`collectGradeChanges` in `src/lib/gradebook.ts`).

### 3.2 Missing vs zero

- **Blank / null score:** not saved as a grade; excluded from weighted averages and from `grades_posted` email items (`gradesPostedItemsFromSavedScores`, tests in `gradebook.test.ts`).
- **Zero:** treated as a recorded score (included in averages and notifications).

### 3.3 Missing-grade notifications

Separate from “grade posted”:

- After save, `publishMissingGradeAlerts` may invoke `notify-missing-grades` for activities with published grades but missing student scores (`src/lib/missing-grade-notifications.ts`).
- SQL `notify_missing_activity_grades` writes **Missing grade** inbox rows when appropriate (`20261018130000_missing_grade_requires_recorded_score.sql`).

### 3.4 Grade posted: dashboard vs email

| Channel | Mechanism |
|---------|-----------|
| **Student dashboard inbox** | Database trigger `notify_first_activity_grade` on `submissions` when a score is **first recorded** (`INSERT` or `UPDATE` from null). Dedupe key `grade-posted:{activity_id}:{student_id}` (`20261022153000_student_grade_posted_inbox_dedupe.sql`). **Regrades** (score already set) do **not** create a new “Grade posted” row. |
| **Email** | Client calls `emailGradesPosted` → `send-notification` event `grades_posted` (Brevo). Independent of inbox; failure does not remove inbox rows. |

Partial save example (A1=16, P1 blank, ME=45): only A1 and ME are saved (`gradebook.test.ts`); `grades_posted` email payloads include those two items only. Inbox “Grade posted” rows follow the trigger rules above when migration `20261022153000_student_grade_posted_inbox_dedupe.sql` is **applied on the target database**—the repository does not assert that staging or production have run it, and inbox behavior is not covered by `gradebook.test.ts`.

### 3.5 Reports inside EDGE

- **Reports** (`src/pages/dashboard/Reports.tsx`): in-app preview dialog, **print**, and **download** (export); data loaded from Supabase queries—not a separate “report file” store.
- **Enhanced reports** route for extended reporting UI.

Struggling areas are surfaced via risk status (missing categories, provisional labels), gradebook missing counts, and instructor monitoring views—not a single global “struggling subjects” document.

---

## 4. Manual, automated, and hybrid workflows

| Workflow | Mode | Trigger / location |
|----------|------|-------------------|
| Grade entry & save | **Manual** | Instructor in gradebook |
| Weighted grade & risk classification | **Automated** (after trigger) | `predict-risk` when client calls `recalculateSubjectRisk` |
| Student “Grade posted” inbox | **Automated** | DB trigger on `submissions` (**migration required**) |
| Grade posted email | **Automated** (request) | Client → `send-notification` → Brevo (**secrets + deploy**) |
| Missing-grade inbox/email | **Hybrid** | Instructor save → `publishMissingGradeAlerts` → Edge/SQL |
| Dashboard inbox (general) | **Automated** | DB triggers / RPCs → `user_inbox_notifications` |
| Email notifications | **Automated** (request) | Edge Functions; provider acceptance ≠ delivery |
| Student/staff registration | **Manual** approve/reject | Admin UI; rejection email via `registration_rejected` |
| Enrollment request/decision | **Manual** decision | Instructor UI; inbox trigger + `enrollment_decision` email |
| Parent link | **Manual** two-step | Student + admin; triggers + `send-parent-email` |
| Attendance | **Manual** entry | Instructor; may trigger risk recalc and notifications per feature |
| Engagement scan | **Scheduled** | Vercel cron → `scan-engagement` (**deploy dependency**) |
| Early warning to student | **Manual** send | Instructor dashboard → `sendEarlyWarningEmail` |
| Risk alert email to student | **Automated** (gated) | `predict-risk` if `EDGE_RISK_EMAILS_ENABLED=true` |
| Counseling referral | **Manual** create | Instructor; `send-referral-notification` + inbox triggers |
| Heuristic study recommendations | **Hybrid** | **Once per `AIRecommendations` mount** (`syncAttempted` ref): RPC runs only when latest `predictions.risk_level` maps to Vulnerable/Crucial (`learning-recommendations-sync.ts`); stable/excelling bands skip sync |
| AI Coach chat | **Manual** | Student opens coach; each message → `ai-coach` |

---

## 5. Notifications and delivery limitations

### 5.1 Channels

1. **Durable inbox** — `user_inbox_notifications`; shown in-app via `useDurableInboxNotifications`; backup poll interval `DURABLE_INBOX_POLL_MS` (3 minutes).
2. **Email** — Brevo transactional API (`BREVO_API_KEY`, `BREVO_FROM`); see [NEW_SUPABASE_SETUP.md](./NEW_SUPABASE_SETUP.md).

Email failure must not delete inbox rows; clients often show toasts when `emailError` is returned.

### 5.2 Stages (do not conflate)

1. Notification row inserted (database).
2. Email HTTP request built and sent (Edge).
3. Provider accepts message (Brevo API success).
4. Message delivered to mailbox (not verified by EDGE).

EDGE records API success from Brevo when the Edge Function receives it; it does **not** track bounces, spam filtering, or recipient mailbox availability. Transactional email depends on operator-configured `BREVO_API_KEY` and `BREVO_FROM` (see setup docs). **No sender configuration guarantees delivery to every user**—quota limits, provider policy, invalid addresses, and student email access are outside application control.

### 5.3 Representative events

| Event | Inbox | Email (typical) |
|-------|-------|-----------------|
| Registration rejected | — | Applicant (Brevo) |
| Enrollment rejected/approved | Student | Student (`enrollment_decision`) |
| First grade recorded | Student | Student (`grades_posted`) |
| Missing grade | Student | Student (`notify-missing-grades`) |
| Parent link request | Student | Student (`send-parent-email`) |
| Linked parent grade/risk/attendance | Parent | Parent (linked-parent helpers) |
| Referral | Student/counselor | Configured recipients |
| Early warning | Student (`interventions` row + inbox poll for “Early warning alert…”) | Student (`send-notification`) when email present |

Exact behavior requires deployed migrations and Edge Functions matching this repository.

---

## 6. AI Coaching, recommendations, and limitations

### 6.1 AI Coach (interactive LLM)

- **Purpose:** Academic coaching—scores, grades, attendance, study plans—from the **signed-in student’s** records.
- **Invocation:** `src/lib/invoke-ai-coach.ts` → `ai-coach` Edge Function (OpenAI; `OPENAI_API_KEY` required).
- **Authorization:** Coach loads context for the authenticated student only; guard replies if another student is requested (`OTHER_STUDENT_REPLY` in `coach-chat.ts`).
- **Out of scope:** Non-academic topics receive `OUT_OF_SCOPE_COACHING_REPLY` (exact string in `supabase/functions/ai-coach/coach-chat.ts`).
- **Missing data:** Prompt instructs the model not to invent scores; deterministic fallbacks include `DB_FAILURE_REPLY` when records cannot load and record-based summaries when the model is unavailable (`academic-context.ts`).
- **Risk classification:** Coach text explicitly states it does not change official risk classification when using record-based fallback.
- **Does not classify risk:** Official bands come from `predict-risk` only.

Example fallback (implemented, not generic placeholder):

> “I couldn't load your academic records right now, so I can't answer questions about your scores or grades. Please try again in a moment.”

The panel example *“I cannot provide the information you requested because the necessary information is unavailable”* is **conceptually aligned** with coach guardrails but is **not** guaranteed to be the exact UI string; coaches use the specific replies above and model instructions to admit missing data.

### 6.2 AI Recommendations page (heuristic, not LLM chat)

- On first load when latest `predictions.risk_level` is Vulnerable/Crucial (`at_risk` / `critical`), `syncLearningRecommendationsForStudent` runs **once** (`syncAttempted` ref).
- RPC `sync_learning_recommendations_for_student` calls database logic `generate_learning_recommendations`—**not** a separate AI risk model.
- If RPC is missing on the database, sync returns `recommendation_sync_not_deployed`.
- This is **not** full automation on every login or a continuous LLM job.

### 6.3 Limitations (summary)

- Incomplete or late instructor data → provisional risk, missing notifications, or coach “unavailable” replies.
- AI service errors, rate limits, or missing API keys → fallback or error messages; no fabricated grades.
- Recommendations may be stale until the next sync conditions are met.
- All AI outputs are advisory; see [ACADEMIC_DISCLAIMER.md](./ACADEMIC_DISCLAIMER.md).

---

## 7. Early warning, feedback, referrals, parent monitoring

### 7.1 Early warning

Instructors send early warnings from the instructor dashboard: an `interventions` record is inserted first, then optional email via `sendEarlyWarningEmail` → `send-notification` when the student has an email on file (`InstructorDashboard.tsx`). This is **instructor-initiated**, not fully automatic from risk alone.

### 7.2 Student feedback

Students submit feedback (`student_feedback`, `student_engagement_feedback`). Instructors view/reply via instructor feedback UI; counselors see related context on referrals (`GuidanceReferrals.tsx`). Authorization is enforced via RLS and role checks—verify policies before claiming cross-role access.

### 7.3 Counseling referrals

Created by instructors; notifications via `send-referral-notification` and counselor/student inbox triggers (migrations under `202610051*` / `202610052*`).

### 7.4 Parent performance

Parents with **approved** links see performance and predictions subject to RLS. Notifications for grades, attendance, risk changes, and referrals use linked-parent inbox/email helpers when migrations and Edge deploys are current.

### 7.5 Instructor progress monitoring over time

Instructors monitor cohorts through the instructor dashboard and subject detail views: gradebook trends, risk/prediction tables (refreshed when `predict-risk` runs), attendance entry, engagement panels (`StudentEngagementPanel`, charts), and intervention/referral history where enabled. This is **observational** over stored submissions and predictions—not a separate longitudinal report file unless exported from **Reports**.

---

## 8. Academic disclaimer

Full and short disclaimer text lives in [ACADEMIC_DISCLAIMER.md](./ACADEMIC_DISCLAIMER.md) and `src/lib/academic-disclaimer.ts`. UI surfaces include landing footer, Performance Insights, instructor/student prediction views, and parent predictions (see disclaimer doc table).

---

## 9. Panel requirements checklist (documentation coverage)

| Requirement | Doc status in this guide |
|-------------|---------------------------|
| In-app reports (view/print/export) | §3.5 |
| Risk terminology (Excelling/Stable/Vulnerable/Crucial) | §2.1 |
| Operational risk definitions | §2.2–2.6 |
| Early-warning alerts | §4, §7.1 |
| Academic disclaimer | §8 + link |
| User roles & permissions | §1 |
| Grades & struggling areas | §3 |
| Manual vs automated | §4 |
| AI Coaching & limitations | §6 |
| Instructor progress monitoring | §7.5 |
| Student feedback | §7.2 |
| Counseling referrals | §7.3 |
| Parent dashboard | §1, §7.4 |
| Percentage grading | §2.3, §3 |
| Missing-data notifications | §3.2–3.4 |

Items marked **deployment dependency** throughout still require the correct Supabase migration history, Edge deploy, and secrets on the target project.

---

## 10. Related documents

- [ACADEMIC_DISCLAIMER.md](./ACADEMIC_DISCLAIMER.md) — legal/academic disclaimer text and UI placement
- [DEPLOY_CHECKLIST.md](./DEPLOY_CHECKLIST.md) — Vercel, cron, Brevo, smoke checks
- [NEW_SUPABASE_SETUP.md](./NEW_SUPABASE_SETUP.md) — new project setup, Brevo, risk email gate, AI secrets
