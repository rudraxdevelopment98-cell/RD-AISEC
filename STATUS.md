# RD-AISEC — Project Status (handoff)

_Last updated: 2026-06-28. Owner/architect: Kuldeep J._

A single source-of-truth snapshot so work can continue from another machine /
Claude account and merge back cleanly.

## What this is
An AI-assisted, all-in-one cybersecurity operations portal: bug bounty +
pentest + digital forensics + consulting. Next.js 14 (App Router) + TypeScript +
Tailwind + Prisma/Postgres (Neon), deployed on Vercel. A stdlib-only Python
**runner** (Kali) polls the portal over HTTPS, runs allowlisted tools, and posts
results back; the portal parses them into findings.

## Branch / workflow
- Develop on **`claude/ai-cybersecurity-dashboard-vu46gc`**, then `--no-ff`
  merge to **`main`** and push both. (CI = `npx next build`.)
- Always run a build before committing: `DATABASE_URL=... DIRECT_URL=... npx next build`.
- `PHASES.md` is the running changelog/roadmap; keep it updated.

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
  **💥 Auto-pwn** (capture→crack→reveal), security assessment → save as findings.
- **Network map** (per-scan + full-engagement merged), **Learn** roadmap,
  **Readiness check**, **How-it-works guide**, runner cancellation (v24).
- Security headers/CSP, encrypted secrets, RBAC, cron fail-closed, API per-section
  access checks (lib/api-guard.ts), audit-pass fixes (pipeline liveness, races).

## Runner
- Current version: **25** (`lib/runner-constants.ts` RUNNER_VERSION must match
  `runner/rdaisec_runner.py`). v25 = **self-update**: the runner pulls the latest
  script from the portal (`/api/runner/script`, runner-token authed) at startup
  and hourly-when-idle, then re-execs itself. **One final manual re-pull to v25**
  on the Kali box, after which it updates automatically — no more re-pulls.
  Disable with `RUNNER_AUTO_UPDATE=0`. v24 = job cancellation kills the process.

## Required env (Vercel)
- `DATABASE_URL`, `DIRECT_URL` (Neon pooled + direct), `AUTH_SECRET`,
  Google OAuth (`AUTH_GOOGLE_ID/SECRET`), `AUTHORIZED_EMAILS` (owner allowlist),
  **`CRON_SECRET`** (cron now fails closed without it).
- Optional: `ANTHROPIC_API_KEY` (AI drafting), `RD_HUNTER_HANDLE`
  (identify-your-traffic header on bug-bounty scans).

## Known follow-ups (not yet done)
- API access checks added to the main data routes; `assistant` + `lab/ai-draft`
  still only check auth (low risk — AI features, not data dumps).
- Finding dedup is by exact title → near-duplicates when a count in the title
  changes (cosmetic report bloat). Consider a normalized key.
- Result-route nuclei→exploit chain has no depth cap (usually converges; could
  add a chained flag).
- Tenancy: all approved members share all data (no per-record ownership). Fine if
  intended; revisit if multi-tenant is needed.
- WiFi evil-twin (wifiphisher) is a copy-run-in-terminal command (interactive),
  not a headless job — by design.

## Safety posture (keep)
- Offensive actions are authorization-gated; weaponization is explicit/one-click,
  never auto-fired (only non-destructive validation auto-runs). WiFi attacks are
  for networks you own/are authorized to test. No detection-evasion features.
