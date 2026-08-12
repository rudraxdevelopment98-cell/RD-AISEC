# RD-AISEC — Full-System Audit & Upgrade Roadmap

_Date: 2026-08-12. A whole-system audit (data model, backend, engine, UI/UX,
security, foundation) with a prioritized, staged upgrade plan. This is the
source of truth for the restructure; execute in waves, commit small, verify each._

## Executive summary

The product is **far more real and complete than it feels** — 37 working
dashboard pages, no dead nav links, a genuine recon→scan→exploit→triage→report
engine, a mature self-updating runner, and strong config hygiene (real CSP/HSTS,
`strict` TS, no `ignoreBuildErrors`). The problems are **specific and fixable**,
not "it's all broken." Three themes dominate:

1. **Security authz gaps** — a member can run commands on / control *any*
   machine because runner actions check "signed in" but not "owns this runner."
   (Highest priority; partially fixed in this pass.)
2. **Engine reportability** — real bugs to earn bounties are lost to concrete
   pipeline defects (all open ports collapse into one finding; TLS scanning is
   skipped on HTTPS; no takeover/`.git`/JS-secret detectors). This is *why it
   finds "nothing reportable."*
3. **Cluttered UI + inconsistency** — heavy cinematic effects, 58 hand-styled
   forms vs a dead design-system class, no loading states. The goal: a clean,
   calm, professional look.

---

## Findings by domain (ranked, with file refs)

### Security (product hardening — it's a security tool, bar is high)
- **[CRITICAL] Custom-command RCE on any runner** — `lib/runners.ts queueCustomJob`
  checked only "signed in"; any member could run commands (incl. sudo) on another
  owner's machine, bypassing the PTY unlock gate. **✅ FIXED this pass** (owner +
  unlock gate).
- **[CRITICAL] Same via WiFi** — `lib/wifi.ts runWifiCommand` — arbitrary command,
  no ownership check. _(P0, next.)_
- **[HIGH] Runner/job action IDOR** — `queueJob`, `install*`, `deleteRunner`,
  `restartRunner`, `setRunner*`, `cancelJob/deleteJob/deleteJobs`, sensing job
  routes: operate on any `runnerId`/job id with no ownership scope. _(P0, next.)_
- **[HIGH] Server actions bypass the section gate** — `canAccess` runs only in the
  dashboard layout; `"use server"` actions are directly-invocable POSTs. Need a
  `guardAction(section)` mirroring `guardApi`. _(P0/P1.)_
- **[MED] Crypto fell back to a hardcoded dev key** if `AUTH_SECRET` unset.
  **✅ FIXED this pass** (fails closed in prod).
- **[MED] Target validator accepted a leading `-`** (arg injection). **✅ FIXED.**
- **[HIGH] Dev-login backdoor** default-on with `"letmein"`. **✅ FIXED this pass**
  (off by default, no default password, never in prod).

### Foundation (deps / build / tests)
- **[CRITICAL] `next-auth` frozen beta** with 3 Auth.js CVEs. _(P0 — careful bump.)_
- **[HIGH] Next.js pinned `14.2.5`**, 30 security patches behind → `14.2.35`. _(P0.)_
- **[HIGH] `npm audit`: 3 critical / 10 high** (incl. postcss). _(P0.)_
- **[HIGH] No portal CI, no test framework** — ~150 modules, 6 orphan hand-rolled
  test files. Adopt Vitest + a PR workflow (tsc/lint/build/test). _(P1.)_
- **[MED] Doc drift** — STATUS/TASKS/PHASES/ROADMAP contradict; collapse to one.

### Engine (the reportability chain — the core value)
- **[HIGH] Dedup collapses all open ports on a host into ONE finding**
  (`lib/dedup-core.ts` + `suppression-core.ts`) — massive recon signal loss. _(P1.)_
- **[HIGH] TLS scanning skipped on most HTTPS hosts** (`lib/engine/scan-plan.ts`)
  — a whole reportable class goes dark. _(P1.)_
- **[HIGH] Missing high-yield detectors**: subdomain takeover (has a class, no
  detector), exposed `.git`/`.env`/backups, JS-secret harvesting, CORS/open-redirect,
  web default-creds — the fresh-scope classes that actually pay. _(P1.)_
- **[MED] No persisted "reportable" state** on the automated pipeline; three
  scoring systems (`risk-core`, `bb-engine`, `finding-signal`) can contradict.
  Make one grader authoritative and persist it. _(P1/P2.)_
- **[MED] Three finding-creation paths**, two bypass the accuracy/dedup/enrich
  chain — unify into one `ingestFindings()`. _(P2.)_

### Data model
- **[HIGH] Hot paths unindexed** — `Job(status,...)`, `Finding(status,severity,...)`,
  `Runner.lastSeenAt`; add matching indexes + `pg_trgm` for title search. _(P2.)_
- **[HIGH] Unbounded growth** — `ControlMessage`, `AuditEvent`, `Job.output` have
  no retention; move live PTY bytes off Postgres. _(P2.)_
- **[MED] Free-form string enums / JSON-in-string** — convert to Postgres enums
  + `jsonb`. Loose FKs (`Submission.findingId`, `Pipeline.runnerId`, …). _(P2/P3.)_
- **[MED] Tenancy model is half-applied** — decide single-team vs per-owner and
  enforce consistently. **← needs your decision (see below).**

### UI/UX (the "clean, professional" goal)
- **[HIGH] No loading states** — every navigation freezes on the old page. Add
  `loading.tsx` skeletons. _(P1 — visible win.)_
- **[HIGH] 58 hand-styled forms** vs a dead `.glass-input`; extract one `<Field>`.
- **[MED] Visual clutter** — heavy cinematic bg (liquid blobs, neural net, glows),
  hardcoded hex outside the token system; dial back to calm whitespace + tokens.
- **[MED] 3 of 4 disciplines are brochures** (pentest/forensics/consulting) vs the
  real bugbounty workspace.
- **[MED] a11y** — no `aria-current`, color-only state, ignores system theme.

---

## The roadmap (waves — execute in order, verify each)

**Wave 0 — P0 security & config (IN PROGRESS)**
- ✅ Custom-command RCE gated (owner + unlock); crypto fails closed; dev-login
  fails closed; target-dash injection blocked.
- ▶ Next: ownership scope on the rest of the runner/job actions + `runWifiCommand`;
  `guardAction` helper; dependency security bumps (next 14.2.35, next-auth, postcss).

**Wave 1 — Engine reportability (the "find real bugs" fix)**
- Fix the open-port dedup bug; guarantee TLS scanning; add detectors: subdomain
  takeover, `.git`/`.env`/backup exposure, JS-secret harvesting.
- Persist a canonical "reportable" state; make one grader authoritative.

**Wave 2 — Clean, professional UI (the "less cluttered" goal)**
- Calm the visual system (restrained background, consistent tokens, more
  whitespace); one `<Field>` primitive; `loading.tsx` skeletons everywhere;
  standardize empty/error/loading; a11y pass (aria-current, system theme).

**Wave 3 — Structure & scale (future-proofing)**
- Indexes on hot paths; retention for `ControlMessage`/`AuditEvent`; Postgres
  enums + `jsonb`; real FKs + cursor pagination; consolidate the runner control
  plane (retire `ping`/`job/canceled`); unify the finding-ingest paths.

**Wave 4 — Foundation & depth**
- Portal CI (tsc/lint/build/test) + Vitest; Renovate/Dependabot; collapse docs to
  one dated STATUS; enrich (or honestly reframe) forensics/consulting.

---

## Open decision (blocks the depth of Wave 0/3 authz work)

**Tenancy model:** is this a **single trusted team** (owner + a few approved
members who may all see everything) or a **true multi-owner** portal (each owner's
data isolated)? Today the code is half-way, which is itself the bug. The
runner-control fixes apply either way; but full per-owner row isolation
(engagements/findings/jobs) is only warranted for multi-owner. Pick one and it
gets enforced consistently.
