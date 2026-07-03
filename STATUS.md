# RD-AISEC — Project Status (handoff)

_Last updated: 2026-07-02. Owner/architect: Kuldeep J._

A single source-of-truth snapshot so work can continue from another machine /
Claude account and merge back cleanly.

> **Workflow reset (2026-07-02):** all work is now consolidated onto **`main`**
> (the scattered feature branches were merged/retired). Develop on `main` and
> push. `TASKS.md` is the active checklist; `PHASES.md`/`ROADMAP.md` the history.

## What this is
An AI-assisted, all-in-one cybersecurity operations portal: bug bounty +
pentest + digital forensics + consulting. Next.js 14 (App Router) + TypeScript +
Tailwind + Prisma/Postgres (Neon), deployed on Vercel. A stdlib-only Python
**runner** (Kali) polls the portal over HTTPS, runs allowlisted tools, and posts
results back; the portal parses them into findings.

## Branch / workflow
- **Single source of truth: `main`.** Develop on `main` and push (all older
  feature branches are consolidated in).
- Always run a build before committing: `DATABASE_URL=... DIRECT_URL=... npx next build`
  (works in this environment now — the earlier "can't build locally" caveat in
  TASKS.md no longer applies here).
- `TASKS.md` = active work plan; `PHASES.md` = changelog; `ROADMAP.md` = long view.

## Current stage — working end to end
- Bug-bounty programs → engage → **assessment pipeline** (recon → scan → exploit
  → triage → report) with approval gates, deep-scan, per-stage re-run.
- **Engine**: subfinder/amass, httpx, nuclei (CVSS-escalated), nmap -sV, gobuster,
  nikto, sslscan, katana (JS/endpoint), leaked-secret detection, dalfox, sqlmap,
  wpscan, searchsploit + msf checks. Self-bounded tool args + per-tool timeouts.
- **Per-finding ⚔ Exploit it**: check exploitability (live), run technique / build
  PoC in Lab, **verify & confirm yourself**, webhook notify, save to report.
- **WiFi**: scan (managed nmcli / monitor airodump), inspect (devices, vendor,
  distance, traffic), capture (handshake/PMKID/auto), crack (aircrack/hashcat),
  **💥 Auto-pwn** (capture→crack→reveal), **🪤 Auto Evil-Twin** (one-click fake-AP
  captive portal via wifiphisher, headless/PTY, quit-on-capture → reveals the
  submitted password), security assessment → save as findings.
- **Network map** (draggable/adjustable canvas; per-scan + full-engagement),
  **Learn** roadmap, **Readiness check**, **How-it-works guide**.
- **Job priority**: jobs have a `priority` (claimed priority-desc then oldest-first);
  "⚡ Run first" when queuing and "↑ Run next" on a queued job jump the queue.
  Automation auto-prioritizes too: per-finding "Exploit it" (40) and the pipeline
  exploit stage (20) outrank routine recon/scan (0).
- Security headers/CSP, encrypted secrets, RBAC, cron fail-closed, API per-section
  access checks (lib/api-guard.ts), audit-pass fixes (pipeline liveness, races).

## Accuracy & intelligence engines (the "find real bugs, don't over-claim" layer)
- **Proof-by-exploitation confidence** (`lib/exploit-confidence.ts`): findings are
  graded **reported → validated → proven**; a bare nuclei/version match is no
  longer auto-`confirmed` — only real extraction/shell/data proves it.
- **Freshness + version-CVE** (`lib/vuln-freshness.ts`, `lib/version-cve.ts`):
  drop stale/patched-CVE false positives from banner-only matches.
- **KEV threat intel** (`lib/threat-intel.ts` + `ThreatFeed`): runner syncs CISA
  KEV; findings for actively-exploited CVEs are flagged (runner v37).
- **Detection taxonomy + phased exploitation strategy** (`lib/vuln-taxonomy.ts`,
  `lib/exploit-strategy.ts`): finding text → vuln class + OWASP/CWE/ATT&CK/CVSS →
  a 5-phase exploitation plan.
- **White-box source recon** (`lib/source-recon*.ts`, `Engagement.sourceRepo`):
  runner clones the repo → code-level hypotheses.
- **Authenticated / session-aware scanning** (`lib/auth-scan.ts`,
  `Engagement.authSession`, encrypted): one auth header injected into
  header-capable tools to reach IDOR / access-control / business-logic bugs.
- **Bug-bounty accuracy engine** (`lib/bb-engine.ts`): states, confidence caps,
  acceptance probability. **Human-review gate** (`lib/review-gate.ts`): owner
  sign-off before high-impact findings publish.
- **Parser negation guard** (`lib/job-parser.ts` `NEG_VULN` / `looksNegated`):
  one canonical "line says SAFE / not vulnerable / up to date / no known vulns"
  check shared by every parser — kills the "matched a keyword inside a negated
  sentence" false positives (sslscan Heartbleed, WPScan "no known vulnerabilities",
  sqlmap "is not vulnerable"). WPScan version-inferred vulns are `confirmed:false`
  (detection, not proof) like nuclei.
- **Import gate** (`lib/finding-gate.ts`): re-judges CVE-bearing findings on
  evidence at import — drops patched, de-confirms unverifiable, trusts parser.
- **Self-improving suppression** (`lib/suppression*.ts`): mark a finding false
  positive → learns a signature and drops matches on future scans; **confirm a
  finding real → learns an ALLOW rule that protects that class** (allow beats
  suppress). All rules visible + reversible on the Findings page.
- **Real exploit generation** (`lib/exploit-generator.ts`): per-vuln-class PoC
  (VULNERABLE/SAFE, target-filled) on each finding's Exploit page + browser/
  DevTools manual-repro playbook (`lib/validation-guide.ts` `manualRepro`).
- **Assessment pipeline** produces a standard result schema + executive tables
  (`lib/assessment.ts`); **reports** use a human-voice engine + evidence-first
  graded structure + platform-aware submission.

## Other subsystems
- **Shiva** (`/dashboard/shiva`): in-portal MCP-security dashboard — Scanner ·
  Gateway (+live proxy) · Attack Range · Benchmark, backed by TS ports
  (`lib/mcp-scan.ts`, `lib/mcp-gateway.ts`) of the `shiva/` Python subproject.
- **SIEM** (`/dashboard/siem`, owner-only): `AuditEvent` model + `lib/audit.ts`
  logs login/logout, job.queued, etc. into a filterable activity timeline.
- **UI**: Neo-style three-pane shell (nav · canvas · Live-Ops rail, collapsible),
  token-based **liquid-glass design system with a light/dark theme toggle**, tabs
  across Jobs / Exploitation / Bug Bounty / Engagement detail, global Autoscan FAB.
- **Voice Command Center** (`components/voice-command-center.tsx`,
  `lib/voice-commands.ts`): hands-free, 100% browser-native (Web Speech API —
  no cloud, no key). Voice→commands ("go to findings", "scan example dot com",
  "search for XSS"), spoken TTS replies, wake word ("Shiva …") / always-listening.
  Access-aware routing; pure intent parser is unit-tested. Bottom-left FAB.

## Runner
- Current version: **39** (`lib/runner-constants.ts` RUNNER_VERSION must match
  `runner/rdaisec_runner.py`). Self-updates from v25+, so runners pull new
  versions automatically. Highlights since v30:
  - **v39** redact auth-session/cookie when the runner echoes a command.
  - **v37** sync CISA **KEV** catalog to the portal (`/api/runner/intel`).
  - **v36** never let the main loop die under a large queue.
  - **v35** SNMP/SMB/Joomla tooling + enforce HTTPS on runner comms.
  - **v33** auto-install a job's missing tool before running it.
  - **v32** stop going offline during long jobs; auto-start on boot.
  - **v31** +11 tools (feroxbuster/dirsearch/testssl/sslyze/nbtscan/smbmap/fierce/
    sublist3r/commix/gospider/waybackurls). Also: source-repo clone (white-box),
    auth-header injection, self-heal/network recovery after WiFi monitor mode.
- v30 = **per-machine concurrency** (portal-controlled
  via X-Runner-Max-Workers poll header, live, clamp 1..16 — Machines page picks
  how many jobs run in parallel) + **faster self-update** (checks every 5 min and
  whenever the runner goes idle, default UPDATE_CHECK_SECONDS=300). v29 =
  **audit-hardening**: self-update TOCTOU
  closed (idle re-check + re-exec hold WORKERS_LOCK), apt→go fallback resolves
  the binary name robustly, INSTALL_PKGS mirrors the portal (tor/torsocks/
  aircrack), ffuf output parsed correctly (payload→URL reconstruction).
  v28 = **ffuf** (web fuzzer) + **gau** (known-URL
  discovery) as one-click tools; **nuclei** gains a `go install` fallback.
  v27 = **go fallback** for subfinder/naabu/katana/
  dalfox (apt-primary; falls back to `go install` if apt fails/unavailable).
  v26 = **non-apt installs**: tools with no apt
  package (httpx) install via `go install` (allowlisted source on the runner;
  bootstraps Go if missing). v25 = **self-update**: the runner pulls the latest
  script from the portal (`/api/runner/script`) at startup and hourly-when-idle,
  then re-execs. After the v25 re-pull it auto-updates to v26 itself — no manual
  pull. Disable with `RUNNER_AUTO_UPDATE=0`. v24 = job cancellation kills procs.

## Required env (Vercel)
- `DATABASE_URL`, `DIRECT_URL` (Neon pooled + direct), `AUTH_SECRET`,
  Google OAuth (`AUTH_GOOGLE_ID/SECRET`), `AUTHORIZED_EMAILS` (owner allowlist),
  **`CRON_SECRET`** (cron now fails closed without it).
- Optional: `ANTHROPIC_API_KEY` (AI drafting), `RD_HUNTER_HANDLE`
  (identify-your-traffic header on bug-bounty scans).
- Optional: `AUTH_REDIRECT_PROXY_URL` (OAuth on Vercel **preview** deploys) —
  set to `https://<prod-domain>/api/auth` on **both** Production and Preview
  (same value), with `AUTH_SECRET` identical across both. Fixes preview
  `redirect_uri_mismatch` by reusing production's one registered callback. See
  GOOGLE-LOGIN.md → "Preview deployments". (auth.config.ts: `redirectProxyUrl`
  + `trustHost: true`.)

## Known follow-ups (not yet done)
- API access checks added to the main data routes; `assistant` + `lab/ai-draft`
  still only check auth (low risk — AI features, not data dumps).
- Finding dedup is by exact title → near-duplicates when a count in the title
  changes (cosmetic report bloat). Consider a normalized key.
- Result-route nuclei→exploit chain has no depth cap (usually converges; could
  add a chained flag).
- Tenancy: all approved members share all data (no per-record ownership). Fine if
  intended; revisit if multi-tenant is needed.
- Shiva scanner/gateway logic exists twice (Python `shiva/` + TS `lib/mcp-*.ts`
  ports) — keep them in sync when either side changes.
- STATUS/TASKS/PHASES can drift from code — trust `RUNNER_VERSION`, the schema,
  and the build over the docs when they disagree.

## Safety posture (keep)
- Offensive actions are authorization-gated; weaponization is explicit/one-click,
  never auto-fired (only non-destructive validation auto-runs). WiFi attacks are
  for networks you own/are authorized to test. No detection-evasion features.
