## EDGE - Student Risk Analysis and AI Coaching System

EDGE is an academic risk analysis and early warning platform for students and instructors. It combines real-time Supabase-backed data, AI-powered coaching, and modern React UI to monitor performance, attendance, scores, and risk predictions.

### Key features

- Student and instructor dashboard experience
- Subject-level reporting and detail views
- Attendance tracking and score history
- Risk prediction and performance insights
- AI learning assistant / coach integration
- Communication hub for notifications and messages
- Administrative tools, programs, enhanced reports, and settings
- PWA support with install prompt and desktop notifications
- Supabase authentication, realtime notifications, and serverless Edge functions

### Tech stack

- Vite + React + TypeScript
- Tailwind CSS + shadcn-ui component library
- Supabase for auth, database, realtime, and Edge Functions
- OpenAI-powered assistant via `ai-coach` Edge Function
- React Router DOM for client routing
- TanStack Query for data fetching and caching
- Vitest for testing

### Getting started

```sh
# Install dependencies
npm install

# Start development
npm run dev
```

Open the app at `http://localhost:5173`.

### Available scripts

- `npm run dev` - start development server
- `npm run build` - build production assets
- `npm run build:dev` - build in development mode
- `npm run preview` - preview the production build locally
- `npm run lint` - run ESLint across the project
- `npm run test` - run tests with Vitest
- `npm run test:watch` - run Vitest in watch mode

### Environment variables

Create a `.env` file with the following values:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-public-anon-key
```

For AI coach support, configure the Supabase Edge Function secrets in your Supabase project, such as `OPENAI_MODEL`, or use the default model from `supabase/functions/ai-coach`.

### Deployment

This app can be deployed to static hosting providers that support Vite apps, including:

- Vercel
- Netlify
- Cloudflare Pages
- any static host with SPA rewrite rules

If you use Supabase, ensure your environment variables are configured in the deployment settings and that the Supabase Edge Functions are deployed.

#### Vercel

1. Connect the repository in the Vercel dashboard (or use the Vercel CLI).
2. Set the same `VITE_*` variables in **Project → Settings → Environment Variables** as in your local `.env`.
3. Use the default **Framework Preset: Vite** (build command `npm run build`, output directory `dist`).

This project includes `vercel.json` with a rewrite so every path serves `index.html`. That is required for **React Router** client routes: without it, opening or reloading a deep link such as `/dashboard` returns a **404** from the CDN because no file exists at that URL. Vercel still serves real static assets (for example under `assets/`) before applying the rewrite.

#### Other hosts

Configure your host so unknown paths fall back to `index.html` (for example Netlify `_redirects` or Cloudflare Pages **SPA** / `_routes.json` behavior).

### Notes

- The frontend relies on Supabase auth and database access.
- Realtime notifications require Supabase realtime-enabled tables.
- The AI coach is invoked through `src/lib/invoke-ai-coach.ts` and requires a signed-in user session.
