# RD-AISEC — Active Work Plan

_A living checklist for the current initiative so work can resume cleanly if a
session stops. Update the boxes as items ship; push after each task._

Legend: ✅ done · 🔄 doing · ⬜ todo · ⚠️ blocked/needs-decision

**Worker:** Claude (mobileicu) · **Branch:** `main` (push after each task)
**Build caveat:** this environment can't run `next build` (Prisma engine download
is blocked by the sandbox proxy); portal changes are isolated-typechecked +
pattern-mirrored, and verified on the Vercel deploy.

---

## A. Sidebar · nav · rails
- ✅ Three-pane shell (left nav · center canvas · right Live-ops rail)
- ✅ Collapsible left sidebar (icons-only) + collapsible right rail
- ✅ Tidy sidebar: separators, alignment
- ✅ Centered brand; symmetric header/footer sizes on both rails
- ✅ **Nav colours: ACTIVE = green, inactive = white / dim-white**
- ⬜ Footer parity: make left footer a single compact row to match right footer height (optional)

## B. Filters & sorting
- ✅ Findings: engagement + date + status filters (NavSelect)
- ✅ **Findings: sorting** (severity / oldest / status; default newest)
  - ⚠️ tool/command/machine filters N/A on Findings (no such fields on the model)
- ✅ **Jobs/History: filter by tool · machine · engagement · status (+ command via search) + sort by date/tool/machine/status** (date-range filter optional later)
- ⬜ Apply the same NavSelect filter bar to other list pages (Engagements, Bug Bounty, Runners)

## C. Tabs / organisation
- ✅ Tabs strip is sticky (pins while panel scrolls)
- ✅ **Jobs page → tabs: Active (running/queued) · History (· Archived)**
- ⬜ Audit other long pages for tab/inner-scroll treatment

## D. Right-rail correctness
- ✅ **Bug: rail showed 0/0 while a job runs** → rail now auto-refreshes (15s)
- ✅ Rail content: Needs-attention (critical), Machines, Active jobs, Team (owners)

## E. Runner tools
- ✅ **Added 11 tools** (queueable + one-click install, runner v31): feroxbuster,
  dirsearch, testssl, sslyze, nbtscan, smbmap, fierce, sublist3r, commix (apt) +
  gospider, waybackurls (go). Portal + runner maps mirrored; self-update propagates.
- ⬜ Parsers for new tools where output → findings (generic/leaked-secret already apply)
- ⬜ More PD tools (dnsx/tlsx/asnmap), secret scanners (trufflehog/gitleaks)

## F. Shiva (MCP security)
- ✅ Scanner · Gateway (+live proxy) · Attack Range (+exfil) · Harness
- ⬜ Live-test the proxy (needs SDK + a real client)
- ⬜ More scanner checks / Range attacks; CI packaging

## G. SIEM (new)
- ✅ **AuditEvent model + additive migration** (CREATE TABLE only), `lib/audit.ts`
  (best-effort logger), login/logout hooks, owner-only `/dashboard/siem` timeline
  with type/actor/severity/date filters.
- 🔄 More event sources: ✅ job.queued (manual + custom); ⬜ finding.created, report.exported
- ⬜ Surface a real activity feed in the right rail from AuditEvent
- ℹ️ SIEM empty until events occur AFTER deploy — sign out/in or queue a job to populate

## K. Runner reliability & self-healing (v32)
- ✅ **Stop going offline during long jobs**: the heartbeat is the only pinger
  while all workers are busy, and it could die if check_cancellations threw — now
  the whole heartbeat pass is guarded (never dies), ping uses a bounded timeout,
  PING 30s→20s (more margin under the 90s window), check_cancellations never
  raises, and a watchdog in the main loop revives the heartbeat if it ever dies.
- ✅ **Auto-start on boot is the default** in setup.sh (systemd Restart=always +
  WantedBy=multi-user.target; prompt now [Y/n]).
- ✅ Auto-install a job's tool if its binary is missing (apt), then run — so a
  missing tool stops causing job failures (v33; note prepended to the output)
- ✅ Portal self-healing: on a runner-caused job failure the result route
  diagnoses the cause (missing tool / timeout / dead runner / transient net) and
  auto-fixes it — queues a tool install when needed + re-queues the work
  (Job.retries-bounded, max 2), logged to SIEM as job.autoretry. Pure
  diagnosis in lib/self-heal-core.ts (unit-verified). Additive migration.

## J. Remote WiFi / multi-site runners
- ✅ Clarified in the WiFi UI: WiFi is radio (range-limited); place a runner with a
  dongle AT the target site and drive it remotely (already supported per-machine)
- ⬜ Optional: a runner "site/location" label to manage multiple site sensors

## I. Bug reports (human-quality) — IN PROGRESS
- ✅ **Two report formats**: `lib/report-narrative.ts` (human + structured) +
  `ReportBuilder` UI (toggle, copy, validity) wired into the Exploit page.
- ✅ **Validity heuristic** surfaced in the UI (ready | review | weak + reasons).
- ✅ **Submission** (`lib/submission.ts`): platform-aware deep-link (the platforms
  don't allow a researcher API submit, so it's Copy + Submit ↗ to the right page)
  + "Before you submit" hints. Wired into ReportBuilder (platform from engagement
  category). [PR: claude/report-submission]
- ⬜ Surface ReportBuilder on the Findings page + per-finding exploit page too.
- ⬜ Better bug discovery feeding the report (tie into pipeline/exploit).

## H. Misc small fixes (rolling)
- ✅ Pipeline auto-advance fix: recheckPipeline on engagement page load + AutoRefresh
  while running (so stages move hands-free, not only on a runner result POST);
  scoped stage-completion to the current run so an orphaned old job can't block it
- ✅ Motion: per-page fade-up entrance (keyed by route) + a `.stagger-in`
  cascade utility (applied to the dashboard stat grid); reduced-motion guarded
- ⬜ Sweep for stale-data spots that need AutoRefresh
- ⬜ Bounded `max-h` + inner scroll on unbounded lists
- ⬜ Apply `.stagger-in` to more lists (findings, jobs, launchpad groups)

---

### Current focus (in order)
1. Nav colours (A) → 2. Rail 0/0 refresh (D) → 3. Jobs tabs (C) →
4. Jobs/History filters + sorting (B) → 5. Findings sorting (B) →
6. More runner tools (E) → 7. SIEM scaffold (G) → 8. Shiva follow-ups (F)
