# RD-AISEC — Copilot project instructions

These instructions give GitHub Copilot the context to continue this project
consistently. RD-AISEC is an all-in-one **cybersecurity operations portal**
(digital forensics, penetration testing, security consulting) with an AI
assistant, knowledge base, automation, and an offline resource vault — behind a
secure login. It is built for **authorized security testing and education only**.

## Tech stack

- **Next.js 14** (App Router) + **TypeScript** + **Tailwind CSS**
- **Auth.js (NextAuth v5)** — Google/GitHub OAuth + a dev credentials login,
  gated by an email allowlist
- **Prisma** ORM with **PostgreSQL** (Neon in production)
- Deployed on **Vercel** (production branch: `main`)
- Markdown via `gray-matter` + `marked`; diagrams via `mermaid`

## Run & deploy

```bash
npm install                 # runs `prisma generate` (postinstall)
cp .env.example .env        # set DATABASE_URL (Postgres), AUTH_SECRET, etc.
npx prisma migrate deploy   # create tables
npm run dev                 # http://localhost:3000
```

- Build: `npm run build`. Vercel build: `vercel-build` script runs
  `prisma generate && prisma migrate deploy && next build`.
- `vercel.json` pins the framework to `nextjs`.
- Deploy/auth guides: `DEPLOY.md`, `GOOGLE-LOGIN.md`.

## Directory map

```
app/
  page.tsx                      Public landing (cinematic)
  login/page.tsx                Sign-in (OAuth + dev login, error banners)
  dashboard/
    layout.tsx                  App shell: sticky sidebar + sticky top header
    page.tsx                    Overview (cinematic hero, stats, pillars)
    engagements/                List + [id] detail (findings, resources, report)
    analytics/                  Cross-engagement charts
    pentest|forensics|consulting/  Pillar workflow pages (PillarView)
    scan/                       Auto Scan (single + bulk)
    assistant/                  AI security assistant
    knowledge/                  Knowledge Library (list + [slug] viewer)
    library/                    Resource Vault (catalog + Connect drive)
    tools/                      Tool catalog
    shiva/                      Shiva MCP-security docs (mermaid)
  api/
    auth/[...nextauth]/         Auth.js handlers
    assistant/                  Mock/Claude answer endpoint
    scan/ , scan/bulk/          Posture scanner endpoints
    engagements/[id]/report/    Markdown report download
auth.ts                         Auth config + isAuthorized() allowlist
middleware.ts                   Protects /dashboard
lib/                            db, engagements, resources, scanner, knowledge,
                                shiva, ai, report, *-constants, scan-actions
components/                     icons, sidebar-nav, workflow, badges, scanner,
                                drive, resource-list, knowledge-list, etc.
content/topics/*.md             Knowledge base (one topic per file)
data/portal.ts, data/tools.ts   Pillar workflows; tool catalog
shiva/                          Imported sub-project (docs/attack-range/web/supabase)
prisma/schema.prisma            Engagement, Finding, Resource models
```

## Key conventions (follow these)

- **Server Components by default.** Mark client components with `"use client"`
  only when they need state/effects/handlers.
- **Mutations = Server Actions** in `lib/*.ts` files marked `"use server"`.
  A `"use server"` file may export **only async functions** — put shared
  constants in a separate `*-constants.ts` module (see `engagement-constants.ts`,
  `resource-constants.ts`).
- **Auth on every server action and API route**: call `auth()` and reject if no
  session. The email allowlist lives in `auth.ts` (`AUTHORIZED_EMAILS`).
- DB pages that query Prisma must be dynamic: `export const dynamic = "force-dynamic"`.
- Use the single Prisma client from `lib/db.ts` (`import { prisma }`).
- After a mutation, `revalidatePath(...)` the affected route(s).
- **Enums are strings** (SQLite/Postgres-friendly) validated in code against the
  `*-constants.ts` arrays — not Prisma enums.
- New nav items: add to the `NAV` array in `app/dashboard/layout.tsx`
  (icon keys come from `components/icons.tsx` — add an SVG path there if needed).
- Knowledge topics: drop a Markdown file in `content/topics/` with frontmatter
  (`title`, `category`, `tags`, `summary`, `relatedTools`) and `## ` section
  headings (How it works / exploit / find / protect / fix). It auto-appears in
  the assistant and Knowledge Library.

## Design system

- Dark, cinematic theme. Reusable classes in `app/globals.css`: `card`,
  `card-hover`, `btn-primary`, `btn-ghost`, `tag`, `tile`, `orb`, `text-gradient`,
  `text-glow-blue/red`, `panel-red/blue`, `ring-emerald|sky|amber`,
  `accent-emerald|sky|amber`, `nav-link`, `stat-num`.
- Brand color is emerald (`brand`); offense = red, defense = blue/sky accents.
- Keep components small and data-driven; match the surrounding code's style.

## Data model (prisma/schema.prisma)

- **Engagement** (pentest|forensics|consulting; planning|active|completed) →
  has many **Finding** and **Resource**.
- **Finding** (severity info→critical; status open|fixed|accepted|false_positive).
- **Resource** (type link|book|exploit|tool|cheatsheet|other; `url` for online,
  `location` for an offline external-drive label; optional `engagementId`).
- Schema changes need a migration. Without a local DB, generate one with:
  `prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel
  prisma/schema.prisma --script` into a new `prisma/migrations/<ts>_name/`.

## Notable features already built

- Three guided pillar workflows (`data/portal.ts` + `PillarView`/`Workflow`).
- Engagements → findings → **Markdown/print report**.
- **Auto Scan** (`lib/scanner.ts`): passive single-GET posture check (headers,
  cookies, HTTPS) → auto-creates findings; **bulk** mode scans up to 10 targets.
- **AI assistant**: serves knowledge-base topics first; mock generator fallback.
  Real Claude integration is stubbed in `lib/ai.ts` (set `ANTHROPIC_API_KEY`).
- **Resource Vault** + **Connect drive** (`components/drive.tsx`): catalog
  resources; open offline files locally via the File System Access API
  (Chromium only) — nothing uploaded.
- **Shiva** sub-project surfaced under `/dashboard/shiva` with live mermaid.

## Roadmap / good next tasks

- Extend **"Open from drive"** to the engagement detail resources list.
- **AI report writer**: draft an exec summary from an engagement's findings
  (use the `lib/ai.ts` Claude stub).
- **Scan history**: persist scans (new Prisma model) and chart posture over time.
- **Evidence/file uploads** on findings (needs Vercel Blob).
- More knowledge topics; per-pillar trackers.

## Guardrails

- Keep the "authorized testing only" framing; the scanner stays **passive**
  (single GET, no attacks/fuzzing).
- Never commit secrets; `.env` is git-ignored. Don't store files in the DB —
  the Resource Vault stores metadata + links/locations only.
