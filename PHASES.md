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
- ✅ Responsive / mobile nav drawer (drawer portaled to <body> so the header's
  backdrop-blur can't clip it on tablet/mobile)
- ✅ Liquid-glass theme: frosted translucent cards + morphing colour blobs

## ✅ Phase 1 — MVP: engagements → findings → reports *(done)*
- ✅ Engagements (type/status/scope/authorization)
- ✅ Findings (severity/status/recommendation)
- ✅ Report writer (deterministic exec summary) → Markdown + print
- ✅ Passive Auto Scan (single + bulk)
- ✅ Edit engagement (name/client/type/status/scope/authorization) + delete
- ✅ Dashboard nav reorganized (Overview · Engagements · Scanning · Knowledge & tools)
- ✅ Sci-fi dashboard: neural-network backdrop (synapse nodes/edges + traveling
  signals), neural-orb hero emblem, count-up metrics, severity donut, activity
  sparkline, and an animated scan→findings→report flow pipeline (gradient
  connectors, traveling data packets, pulsing nodes). CSS/SVG, no deps,
  reduced-motion aware.
- ✅ Retry a failed/canceled job (re-queue same tool/target/runner)
- ✅ Jobs split into its own page: live Active jobs (machine/online/elapsed) +
  a History table with search / status filter / sort and per-row manage
  (import · retry/run-again · delete) + expandable result/output. Machines page
  now focuses on machine connection + installs and links to Jobs.
- ✅ Background heartbeat (runner /api/runner/ping thread) so a machine stays
  online while busy running a long job or install (no more offline-between-tasks)
- ✅ Global **Findings** page (all engagements) with filters: ATT&CK tactic,
  OWASP category, severity, and title search. Framework badges + analytics bars
  are clickable → drill into "all A03 Injection" etc. Backfill for old findings.

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
- ✅ Jobs History filter fix (auto-refresh only while jobs are live, so
  searching/filtering/sorting History no longer resets)
- ✅ **Frameworks & standards** reference page (MITRE ATT&CK® tactics, OWASP
  Top 10, NIST CSF 2.0, and tooling/detection frameworks: Metasploit, Nuclei,
  Zeek, Suricata, Sigma, CVE/NVD) — grounding for the knowledge base

---

## 🔜 Phase 4 — Reporting & sharing *(no AI)*
- ✅ **P4.1** — Export findings as **CSV** (per engagement + all, honoring the
      Findings-page filters) — includes ATT&CK + OWASP columns. Buttons on the
      Findings page and each engagement.
- ⬜ **P4.2** — Export findings/engagement as **JSON**
- ⬜ **P4.3** — **PDF** report export (polish print, or server-side PDF)
- ⬜ **P4.4** — **Dedupe findings** (same issue from scan + import collapses)
- ⬜ **P4.5** — Report **templates** (exec vs technical; toggle sections)

## ⬜ Phase 5 — Workspace *(no AI)*
- ⬜ **P5.1** — **Assets** model (hosts/domains/apps per engagement)
- ⬜ **P5.2** — Queue scans from an asset (target picker)
- ✅ **P5.3** — **Members / RBAC** — owners invite members by email, scope
      access to specific sections, edit/suspend/remove; members sign in (Google)
      only if approved. Nav filtered per-user; middleware enforces per-section
      access (role/access baked into the JWT; edge-safe auth.config split).
- ✅ **Bug Bounty** — track programs (HackerOne/Bugcrowd/…); paste scope →
      authorized engagement → one-click httpx recon over in-scope targets.
      HackerOne **API auto-sync** (free token) pulls programs + in-scope assets;
      token stored encrypted (AES-256-GCM). Other platforms stay manual (no free
      researcher API).
- ✅ **Full bug-bounty automation** — per-program pipeline (subdomain enum →
      httpx + nuclei over in-scope targets) with **auto-import** of findings
      (deduped, ATT&CK/OWASP tagged); "Run now" + a daily "Enable automation"
      toggle. Wildcard scopes (*.x) are expanded via **amass**, then the
      discovered hosts are scanned automatically. The cron syncs HackerOne and
      runs every auto-enabled program hands-off.
- ✅ **P6.5 Notifications** — Discord/Slack webhook ping when a new finding at/
      above a chosen severity lands (incl. from automation). Settings page (owner).
- ✅ **Deeper pipeline** — automation now runs httpx + nuclei + nmap + gobuster
      per in-scope target (per-tool target form), all auto-imported.
- ✅ **Concurrent runner** — the runner executes up to MAX_WORKERS jobs at once
      (default 3) in worker threads, instead of one at a time (runner v11).
- ✅ **Bulk job management** — select multiple jobs (with select-all), archive /
      restore / delete them; a separate Archived view keeps them on record.
      Plus "Cancel all queued" and auto-archive of finished jobs >30 days old.
- ✅ **Dashboard launchpad** — home page groups every section (access-filtered)
      with one-line descriptions, so the whole portal is reachable from one hub.
      Theme unchanged; no features removed.
- ✅ **Live verbose** — running jobs stream partial output to a "Live output"
      panel (runner v12 streams via /api/runner/job/[id]/progress).
- ✅ **Quick-jump search** (⌘K) — jump to any section, engagement, or program.
- ✅ **Breadcrumbs** on engagement detail; **consistent empty states** with
      guidance + actions (EmptyState component).
- ✅ **Persistent runner config** (v13) — runner auto-loads runner.env /
      ~/.config/rdaisec/runner.env (set token once); setup.sh writes it and
      installs a systemd service (boot start + auto-restart).
- ✅ **Turnkey runner setup** — new-runner box shows a pre-filled copy-paste
      command (portal URL + token) that writes the config file.
- ✅ **Server-driven install packages** (v14) — install endpoint sends the apt
      package name; runner installs correctly without its own map.
- ✅ **Live install output** (v15) — apt installs stream their output to the
      Machines page (like job live output), so you watch progress, not just pass/fail.
- ✅ **Tor fixed** (v16) — bootstrap retries + self-heal + real status
      (connecting/on/no-tor) with one-click tor/torsocks install.
- ✅ **Workflow "Run this stage"** — pentest/forensics/consulting commands run on
      a machine (open Jobs pre-filled) instead of "coming soon".
- ✅ **Bug Bounty progress** — engaged programs on top with scan progress, open
      findings (crit/high), exploit/validate + Report links.
- ✅ **Install fix (v18)** — non-tool packages (metasploit/tor/torsocks/aircrack)
      now report installed (binary check) so they stop reappearing as "missing";
      install timeout raised to 30 min (metasploit is ~2 GB); stale installs
      auto-fail. WiFi scan output parses into AP findings (open/WEP flagged).
- ✅ **WiFi (Phase 9)** — runner auto-detects wireless interfaces + monitor-mode
      capability (v17), reports them; dedicated **WiFi page** notifies to attach a
      monitor dongle, installs aircrack-ng one-click, and launches monitor/scan/
      handshake-capture/deauth/crack actions (authorized only) via the runner.
      Plus WiFi/arp-scan launchers on the Network page.
- ✅ **Help system** — Hint popovers + dismissible HelpBanner components.
- ✅ **Nav reorganized** (Overview · Engagements · Offensive ops · Knowledge · Admin)
- ⬜ **P5.4** — **Audit log** (who queued/edited/exported what)
- ⬜ **P5.5** — Scan **history per asset** (posture trend over time)

## ⬜ Phase 6 — Automation *(no AI)*
- 🔜 **P6.1** — More parsers → findings: ✅ masscan, arp-scan, gobuster,
      WhatWeb, enum4linux, dnsrecon (zone transfer), wafw00f. ⬜ wpscan, sslscan.
- ✅ **Exploit playbooks** — each finding gets curated "ways to exploit/validate"
      (one-click run on a machine) + "how to secure it" steps, matched by type
      (SQLi, XSS, SSH, RDP, SMB, TLS, DNS AXFR, outdated component, web, …).
- ⬜ **P6.2** — **Content discovery** (gobuster/ffuf + wordlist)
- 🔜 **P6.3** — **Scheduled / recurring** jobs — ✅ recurring *posture scans*
      (daily/weekly Vercel cron → saves deduped findings to the engagement;
      pause/resume/run-now/delete on the Auto Scan page). ⬜ recurring *runner*
      jobs (nmap/nuclei on a schedule) still to do.
- ⬜ **P6.4** — **Job chains** (recon → scan → report)
- ⬜ **P6.5** — **Notifications** (email / Discord on critical finding or job done)
- ⬜ **P6.6** — Route the cloud recon pipeline **through the runner**
- ✅ **P6.7** — **arp-scan** — LAN layer-2 device discovery (added as a runner
      tool; needs the runner to run as root).
- ✅ **More tools** — masscan, gobuster, WhatWeb, wafw00f, dnsrecon, dnsenum,
      Amass, theHarvester, enum4linux, searchsploit (all server-driven +
      installable from the portal; no runner re-pull to *queue* them).
- ✅ **Custom command** job — run any command on a connected machine (argv via
      shlex, no shell; authorization-gated). On the Jobs tab + Exploit console.
- ✅ **Exploitation section** — search Exploit-DB for a finding's product, run
      Metasploit/exploit commands via the console, and mark findings secured.
      Metasploit + Exploit-DB installable from the portal.
- ✅ **P6.8** — **Auto-map findings to frameworks** — every finding is tagged
      with its MITRE ATT&CK tactic + OWASP Top 10 category by deterministic
      keyword rules (no AI), at all creation paths (runner jobs, posture scans,
      recon pipeline, Burp import, manual). Shown as badges on findings + in the
      report, and broken down on Analytics (by ATT&CK tactic / by OWASP).

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

## ✅ Auto-exploit (hands-off bug hunting)
- ✅ After recon findings land, the engine derives exploit-validation actions
      (searchsploit the product/CVE, nmap --script vuln on the host) and queues
      them automatically (deduped, converges, no loops). searchsploit output →
      "Public exploits available" findings; nmap vuln → findings. All notified.
- ✅ Weaponized exploitation (Metasploit/aireplay) stays one-click on the
      Exploit page (not auto-fired). 
- ✅ **Auto-confirm + glow + report**: from scan/exploit-search results the engine
      builds validations (nmap --script vuln, Metasploit MS17-010/BlueKeep
      scanner `check`, sqlmap) and runs them. When output proves exploitable, a
      **Confirmed exploitable** finding is created (Finding.confirmed) — it
      **glows** on Findings/Exploit/engagement pages, gets a "✅ confirmed"
      badge, is notified, and is marked in the report. Exploit page has a
      Confirmed-exploitable section → straight to Report.
- ✅ "Automate all programs" one-click: import (HackerOne sync) → Automate all →
      daily recon + auto-exploit + findings + report + Discord notify, hands-off.

## ✅ Findings & Program management
- ✅ Auto bug-bounty pipeline now runs **only on programs you've engaged**
      (created an engagement for) — the daily cron + "Automate" skip synced-but-
      unengaged programs. "Automate engaged programs" + "Pause all" controls.
- ✅ **Findings management bar**: search, multi-select (+ select-all), bulk set
      status, bulk tag a category, bulk delete — all from one action bar.
- ✅ **Categorise findings**: free-form category tag per finding, filter chips by
      category, category shown on each card.
- ✅ **Export / Import findings as CSV**: export honors current filters; import a
      CSV (Title required; Severity/Status/Category/Description/Recommendation
      optional) into a chosen engagement — auto-tagged to ATT&CK/OWASP.
- ✅ **Program management bar**: search programs (name/scope/category/platform),
      category filter chips, multi-select, bulk tag category, bulk set status,
      bulk delete. Add/Edit programs carry a category; ranked by opportunity.
- ✅ **Engagement management bar**: search (name/client/category/scope), filter
      chips by type / status / category, multi-select, bulk tag category, bulk
      set status, bulk set type, bulk delete. Engagements carry a category —
      auto-set to the platform for bug-bounty ones, manual otherwise.
- ✅ **Engagement command center**: inside an engagement, a tile grid to drive
      everything for that case. Scan & recon / Exploit & validate / Fix & triage
      are now **one-click actions** (run immediately on an auto-picked runner);
      research, bug finding, posture, network, report navigate. Locked tiles
      until authorization is recorded.
- ✅ **Assessment pipeline** (new section in each engagement): runs every stage
      in order — recon → scan → exploit → triage → report. When a stage finishes
      it asks for **approval**, then the next runs automatically, until the
      report is ready. **Auto-approve** toggle runs hands-off; pause / resume /
      cancel / restart supported. Stage stepper shows live job progress, and
      triage auto-fills remediation guidance on findings so the report is
      actionable. Pipeline jobs are gate-controlled (their auto-exploit chaining
      is suppressed so progression only happens on approval).

## ✅ Stronger detection engine
- ✅ **Richer automated pipeline**: recon now also fingerprints tech/versions
      (whatweb); the scan stage runs nuclei + **nmap -sV** (service versions) +
      gobuster + **nikto** + **sslscan** — far more coverage than before.
- ✅ **New parsers**: sslscan (weak SSL/TLS protocols, weak ciphers, Heartbleed,
      expired/self-signed certs) and WPScan (flagged WordPress vulns, outdated
      core) now produce findings instead of being ignored.
- ✅ **Better nuclei findings**: capture CVE id, CWE, CVSS, tags, references and
      extracted results; dedupe repeats.
- ✅ **Smarter auto-validation** (exploitActions): WordPress→wpscan, URLs with a
      query param→sqlmap, TLS findings→sslscan, live web→a focused nuclei CVE/
      exposure pass — on top of nmap --script vuln + Metasploit checks.
- ✅ **Wider classification**: more ATT&CK/OWASP keyword rules (XXE, SSTI, RCE,
      open redirect, JWT/secret leaks, .git/.env exposure, Heartbleed/POODLE,
      etc.) and tool inference for accurate framework tags.
- ✅ **Deep scan toggle** (on the assessment pipeline): full TCP port sweep +
      nmap vuln NSE scripts + a larger content-discovery wordlist for maximum
      depth. Standard scan stays fast. Shows a ⚡ Deep badge while running.
- ✅ **Nuclei template auto-update** in the runner (v20): refreshes templates on
      startup and daily in the background, so scans always run the latest CVE/
      exposure checks — no manual `nuclei -update-templates` needed.

## ✅ Research & Exploit Lab
- ✅ Settings: research workspace — Google Drive folder link + Kali exploit
      folder path.
- ✅ Exploit Lab page: build PoCs/exploits from templates (Python PoC, py/bash
      reverse shell, curl path-traversal, Metasploit resource script), edit, and
      **Save to the Kali folder** via the runner (savefile job, v19) — or open
      the research Drive.
- ✅ Submission draft: one-click copy-ready bug report (HackerOne/Bugcrowd style)
      on confirmed findings.
- ✅ Build exploit from a finding: "⚒ Build" on confirmed/ready findings opens
      the Lab pre-filled (template + target) from that finding.
- ✅ Optional AI exploit drafting: "Draft with AI" in the Lab uses the Anthropic
      API when ANTHROPIC_API_KEY is set (your key) to draft a PoC; gated/safe
      message otherwise.

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
