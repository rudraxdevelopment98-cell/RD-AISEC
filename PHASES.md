# RD-AISEC — Phases (command-driven build plan)

This is the **driver's manual** for building RD-AISEC. Work is split into phases;
each phase has small, numbered items. To build something, just say its **ID**
(e.g. `P4.1`) or a phrase ("do the CSV export") — no need to re-explain. I'll
build that item, verify, commit, and merge to `main`.

- ✅ done · 🔜 next up · ⬜ planned
- Each item is sized to roughly one command. AI is **off** by default (your call).
- Full background lives in `ROADMAP.md`; this file is the short, actionable index.

---

## ✅ Phase 0 — Foundation *(done)*
- ✅ Next.js 14 + TS + Tailwind, Vercel + Neon Postgres
- ✅ Auth (Google + email allowlist), protected dashboard, cinematic UI
- ✅ Responsive / mobile nav drawer

## ✅ Phase 1 — MVP: engagements → findings → reports *(done)*
- ✅ Engagements (type/status/scope/authorization)
- ✅ Findings (severity/status/recommendation)
- ✅ Report writer (deterministic exec summary) → Markdown + print
- ✅ Passive Auto Scan (single + bulk)
- ✅ Edit engagement (name/client/type/status/scope/authorization) + delete
- ✅ Dashboard nav reorganized (Overview · Engagements · Scanning · Knowledge & tools)
- ✅ Galaxy dashboard: animated starfield hero, count-up metrics, severity donut,
  14-day activity sparkline, animated scan→findings→report pipeline (CSS/SVG,
  no deps, respects reduced-motion)

## ✅ Phase 2 — Runner & active testing *(done)*
- ✅ Runner architecture (Kali polls, executes, posts back)
- ✅ Tools: nmap, httpx, nuclei, sqlmap, nikto, wpscan, sslscan, whois, dig
- ✅ Output → findings (nmap/httpx/nuclei/sqlmap/nikto)
- ✅ Server-driven tool list + runner health badge (version / tool count)
- ✅ Burp Suite XML import
- ✅ Tor anonymity toggle per runner (routes tool traffic via torsocks; shows exit IP)
- ✅ Quick scans (no engagement) vs engagement/scope scans
- ✅ Install missing tools on a runner from the portal (authorized; apt-only,
  fixed package allowlist incl. nuclei; runner reports which tools are present;
  apt package is server-driven so new installable tools need no re-pull)
- ✅ "Machines" section (renamed Runners) with an Installations-needed panel:
  jobs that fail because a tool isn't installed surface there to approve
- ✅ Job error handling: auto-fail stalled jobs, "runner offline" flag on queued
  jobs, failure reason surfaced + Stop button

## ✅ Phase 3 — Network & visualization *(done)*
- ✅ Network scanning (nmap CIDR presets)
- ✅ Interactive network map (radial SVG, gateway highlighted)
- ✅ One-click "scan this runner's network" (auto-detected local subnet)
- ✅ Monitoring timeline (scans + jobs, 14-day chart)

---

## 🔜 Phase 4 — Reporting & sharing *(no AI)*
- ⬜ **P4.1** — Export findings as **CSV** (per engagement + all)
- ⬜ **P4.2** — Export findings/engagement as **JSON**
- ⬜ **P4.3** — **PDF** report export (polish print, or server-side PDF)
- ⬜ **P4.4** — **Dedupe findings** (same issue from scan + import collapses)
- ⬜ **P4.5** — Report **templates** (exec vs technical; toggle sections)

## ⬜ Phase 5 — Workspace *(no AI)*
- ⬜ **P5.1** — **Assets** model (hosts/domains/apps per engagement)
- ⬜ **P5.2** — Queue scans from an asset (target picker)
- ⬜ **P5.3** — **Roles / RBAC** (owner / analyst / viewer)
- ⬜ **P5.4** — **Audit log** (who queued/edited/exported what)
- ⬜ **P5.5** — Scan **history per asset** (posture trend over time)

## ⬜ Phase 6 — Automation *(no AI)*
- ⬜ **P6.1** — More parsers: **wpscan**, **sslscan** → findings
- ⬜ **P6.2** — **Content discovery** (gobuster/ffuf + wordlist)
- ⬜ **P6.3** — **Scheduled / recurring** jobs
- ⬜ **P6.4** — **Job chains** (recon → scan → report)
- ⬜ **P6.5** — **Notifications** (email / Discord on critical finding or job done)
- ⬜ **P6.6** — Route the cloud recon pipeline **through the runner**
- ⬜ **P6.7** — **arp-scan** — LAN layer-2 device discovery (IP + MAC + vendor),
      feeds the Network Map. *Small; works on the runner's own subnet.*

## ⬜ Phase 9 — Wireless (WiFi) *(needs a monitor-mode USB WiFi adapter on the runner)*
> The runner's VM can't scan WiFi via the Mac's built-in radio — it needs a
> compatible USB WiFi adapter passed through. Only scan networks you own/are
> authorized to test.
- ⬜ **P9.1** — **Target-less "environment scan" job type** (tools that scan the
      air/LAN with no target) — prerequisite for WiFi.
- ⬜ **P9.2** — **WiFi AP discovery** (`nmcli`/`iwlist` passive, or `airodump-ng`)
      → access points with SSID/BSSID/channel/encryption/signal.
- ⬜ **P9.3** — **WiFi visualization** — APs grouped by channel/signal/encryption,
      open/weak-crypto flagged; associated clients.

## ⬜ Phase 7 — Evidence & polish *(no AI)*
- ⬜ **P7.1** — **Evidence attachments** on findings (Vercel Blob)
- ⬜ **P7.2** — Per-engagement **"Queue runner job"** button
- ⬜ **P7.3** — **"Open from drive"** on engagement resources
- ⬜ **P7.4** — More **knowledge topics** (drop-in Markdown)
- ⬜ **P7.5** — Mobile polish for engagement detail + recon tabs

## ⬜ Phase 8 — Optional AI *(needs `ANTHROPIC_API_KEY`; off unless you ask)*
- ⬜ **P8.1** — Live Claude report polish (grounded on findings)
- ⬜ **P8.2** — AI finding triage (severity + remediation suggestions)
- ⬜ **P8.3** — Recon agent (plans + queues runner jobs)

---

## How to drive it
- Say an ID: **"P4.1"** → I build CSV export.
- Or a phrase: **"do the assets model"** → P5.1.
- Or a whole phase: **"Phase 4"** → I'll do the items in order, checking in between.
- I update the ✅ marks here as items ship.
