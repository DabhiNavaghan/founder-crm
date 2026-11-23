# FoundReach

A free directory of startups (server-rendered pages under `api/`) and a signed-in outreach desk (the Vite + React app under `src/`).

- `/` is the landing page: static HTML in `index.html`, with live counts filled in by `src/landing/enhance.js`.
- `/app/pipeline`, `/app/pipeline/:companyId`, `/app/studio?contact=:id`, `/app/profile` are the signed-in app (`src/app/`), routed by `src/lib/router.jsx`.
- `/?save=slug` and `/?draft=slug&contact=id` (links on the public pages) save a directory company into the signed-in user's pipeline.
- Sign-in is Clerk; data is Supabase with row-level security. SQL lives in `supabase/migrations/` and is applied in order.

## Run locally

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and fill in the keys first.

## Build

```bash
npm run build
```

The output directory is `dist`. Deployed on Vercel.
