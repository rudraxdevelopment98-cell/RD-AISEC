# RD-AISEC

**AI-powered cybersecurity learning & practice dashboard.**

A secure, login-gated dashboard where you can explore modern security tools and
ask an AI assistant how to **test, exploit, protect, find, and fix** — built for
authorized security testing and education.

> ⚠️ For authorized security testing and education only. Only assess systems you
> own or have explicit written permission to test.

## Features

- 🔐 **Secure access** — OAuth sign-in (Google / GitHub) gated by an
  authorized-email allowlist, so only approved people get in. A dev
  username/password login is available for local use.
- 🤖 **AI Security Assistant** — enter any tool/technique/vulnerability and get a
  structured walkthrough: how it works, how it's tested & exploited, and how to
  protect, find, and fix it. (Ships with a mock engine; plug in Claude with one
  change — see `lib/ai.ts`.)
- 🧰 **Tool Catalog** — searchable, filterable library of open-source and paid
  security tools across recon, web testing, exploitation, scanning, and defense.

## Tech stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · Auth.js (NextAuth v5).

## Getting started

```bash
npm install                  # also runs `prisma generate`
cp .env.example .env         # set DATABASE_URL to a Postgres connection string
npx prisma migrate deploy    # create the tables
npm run dev
```

Open http://localhost:3000.

Data (engagements, findings) is stored in **PostgreSQL** via Prisma — see
`prisma/schema.prisma`. For local dev, use any Postgres (a free Neon/Supabase DB
works, or a local instance). Inspect data with `npm run db:studio`.

**Deploying?** See [DEPLOY.md](DEPLOY.md) for step-by-step Vercel + Postgres setup.

### Configuration

All config is via environment variables — see `.env.example`. At minimum set
`AUTH_SECRET` (`npx auth secret`). Out of the box, `ALLOW_DEV_LOGIN=true` lets
you sign in with any email and the dev password so you can explore immediately.
For real use, configure an OAuth provider and set `AUTHORIZED_EMAILS`.

### Enabling the real AI

The assistant uses a structured mock by default so everything works without a
key. To use Claude: `npm install @anthropic-ai/sdk`, set `ANTHROPIC_API_KEY`,
and follow the commented steps in `lib/ai.ts`.

## Project structure

```
app/
  page.tsx                 Landing page
  login/                   Sign-in (OAuth + dev login)
  dashboard/               Auth-gated app shell + pages
    assistant/             AI security assistant
    tools/                 Tool catalog
  api/
    auth/[...nextauth]/    Auth.js route handlers
    assistant/             Assistant API (mock/Claude)
auth.ts                    Auth.js config + email allowlist
middleware.ts              Protects /dashboard
lib/ai.ts                  AI adapter (mock + Claude stub)
data/tools.ts              Tool catalog data
```
