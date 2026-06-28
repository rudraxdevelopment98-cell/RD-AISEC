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
- ⬜ **Add more allowlisted tools** to `RUNNER_TOOL_SPECS` (+ runner install map): e.g.
  feroxbuster, dirsearch, whatweb*, wafw00f*, dnsx, tlsx, asnmap, cdncheck,
  trufflehog, gitleaks, nuclei-extra, testssl.sh, hydra (gated), etc. (*some exist)
- ⬜ Parsers for new tools where output → findings

## F. Shiva (MCP security)
- ✅ Scanner · Gateway (+live proxy) · Attack Range (+exfil) · Harness
- ⬜ Live-test the proxy (needs SDK + a real client)
- ⬜ More scanner checks / Range attacks; CI packaging

## G. SIEM (new)
- ⬜ **Scope a lightweight SIEM**: an `AuditEvent` model (login/logout/job/finding
  events), write hooks in auth + actions, and a `/dashboard/siem` timeline with
  filters (actor/type/date). Feeds the rail's real activity log.
- ⚠️ Needs a Prisma migration (generate via `prisma migrate diff` — see ROADMAP).

## H. Misc small fixes (rolling)
- ⬜ Sweep for stale-data spots that need AutoRefresh
- ⬜ Bounded `max-h` + inner scroll on unbounded lists

---

### Current focus (in order)
1. Nav colours (A) → 2. Rail 0/0 refresh (D) → 3. Jobs tabs (C) →
4. Jobs/History filters + sorting (B) → 5. Findings sorting (B) →
6. More runner tools (E) → 7. SIEM scaffold (G) → 8. Shiva follow-ups (F)
