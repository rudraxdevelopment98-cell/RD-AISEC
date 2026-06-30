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

## L. Shiva — MCP security dashboard (in-portal engine)
- ✅ `lib/mcp-scan.ts` — TS port of the scanner (C1–C4), runs live in-browser;
  verified to match the Python scanner on the Attack Range fixtures.
- ✅ `lib/mcp-gateway.ts` — pure policy engine: per-tool allow/flag/block under a
  toggleable policy + runtime call replay with data-flow taint (read-then-exfil
  blocked live). Unit-verified via tsx.
- ✅ **Tabbed dashboard at /dashboard/shiva**: Overview · Scanner · Gateway ·
  Attack range · Benchmark · Docs. Hero + stat strip, icon tabs, action bars,
  sectioned cards. Shared fixtures in `components/mcp/fixtures.ts` (5 scenarios:
  poisoning, benign control, credential exfil, cross-tool escalation, drift).
- ✅ **Scanner playground** (`scanner-playground.tsx`): sample chips + textarea +
  findings panel (severity counts, per-finding evidence/fix), runs in-browser.
- ✅ **Gateway simulator** (`gateway-simulator.tsx`): policy toggles, per-tool
  admission verdicts, and a runtime call-sequence replay (exfil chain caught live).
- ✅ **Attack range** (`attack-range.tsx`): scenario gallery, each scans inline and
  shows caught/missed vs its expected severity.
- ✅ **Benchmark** (`benchmark.tsx`): detection matrix (scenario × C1–C4) + a live
  detection-rate headline; benign control must not over-flag.
- ⬜ Save a scan as findings on an engagement.
- ⬜ More checks: C5 prompt-injection in tool *results* (not just descriptions),
  C6 over-broad scopes/roots, C7 unpinned/remote tool servers.

## M. Shannon parity — exploit accuracy (white-box AI pentester)
Goal: match KeygraphHQ/Shannon's edge — source-aware recon + proof-by-exploitation
(only ship a finding with a working PoC; ~96% on the XBOW benchmark).
- ✅ **Proof-by-exploitation confidence model** (`lib/exploit-confidence.ts`):
  reported → validated → proven, from evidence signals (sqlmap/msf/dalfox/TLS =
  validated; shell/id/data-dump/secret = proven). Unit-verified.
- ✅ **Stop over-claiming**: a bare nuclei/version MATCH is no longer auto-marked
  `confirmed` — only when it actually extracted data. Detections get validated
  downstream by the targeted exploit actions instead.
- ✅ **Report validity gate**: an un-validated ("reported") finding can never be
  "ready" to submit; proof level drives the ready/review/weak suggestion.
- ✅ **Proof-level badge** (`ConfidenceBadge`) on the Findings list, Exploit page
  (confirmed + exploitable rows), and the per-finding exploit page; the glow dot
  now means "proven" (not just a confirmed flag).
- ⬜ Per-class exploit agents (injection · XSS · SSRF · broken auth · IDOR/mass-
  assignment) — structured playbooks per OWASP class.
- 🔄 White-box / source-aware recon:
  - ✅ **Analysis core** (`lib/source-recon-core.ts`, pure + tested): given source
    files → detect frameworks (Express/Next/Flask/Django/FastAPI/Rails/Spring/
    Laravel/…), extract endpoints (incl. Next.js file routes), and emit ranked
    vulnerability HYPOTHESES across 7 classes (injection, rce, ssrf, deser,
    path-traversal, xss, crypto, secrets, auth) with a taint heuristic + a
    "validateWith" suggestion. Hypotheses stay "reported" until proof-by-exploit.
  - ✅ **Ingestion — runner clones the repo** (chosen path A): `Engagement.sourceRepo`
    (additive migration) + `lib/source-recon.ts` server actions. A STRICT validator
    (`isValidRepo`: https:// + [A-Za-z0-9._-/] only, no shell metacharacters / `..`)
    gates the URL before it's embedded in the runner's `git clone` command — verified
    against injection (`;`, `"`, `$(...)`, creds, http, git@ all rejected) and the
    generated command passes `bash -n`. The runner shallow-clones, ships a size-capped
    source blob, the portal reconstructs + `analyzeSource`, and emits framework/endpoint
    info + per-sink hypotheses (critical sinks stored at HIGH — no critical without
    proof). Wired into the engagement Command tab (auth-gated). Clone is read-only +
    auto-deleted.
  - ⬜ One-click "validate this hypothesis" from a source finding (queue the matching
    dynamic check).
- ⬜ Threat-model stage between recon and exploit (attack-surface map → hypotheses).

## P. Bug-bounty accuracy + report engine (master-policy vNext)
North star = the RD-AISEC master prompt: accuracy over quantity, validation over
assumptions, evidence over guesses, human approval, real-world exploitability.
- ✅ **Accuracy engine** (`lib/bb-engine.ts`, pure + tested): per-finding
  `assessFinding` → state (detected/suspected/validated/confirmed_exploitable/
  informational/…), confidence 0–100, policy-adjusted severity (conf<50 caps at
  MEDIUM; conf<75 forbids CRITICAL; CRITICAL needs demonstrated impact), a vuln
  class, and a **bug-bounty acceptance probability** (open port 1%, missing CSP
  1%, validated SQLi ~79%, proven RCE ~98%).
- ✅ **Recon-artifact downgrade**: open ports, missing headers, robots/security.txt,
  tech/version banners, DNS/CDN/historical URLs → INFORMATIONAL, never elevate.
- ✅ **Report sections** (`groupForReport`): Confirmed / Validated / Suspected /
  Informational, with an executive risk score from validated+confirmed ONLY.
- ✅ **Queue-flood fix**: auto-exploit now skips informational findings
  (`worthAutomating`) — fewer junk jobs feeding the runner.
- ✅ **Report validity** now shows state + estimated acceptance %.
- ✅ **Report wired** (`lib/report.ts buildMarkdown`): the exported report now uses
  `groupForReport` — Executive Summary + a validated-only risk score, then
  Confirmed Exploitable / Validated / Suspected / Informational sections, each
  finding showing policy-adjusted severity, state, confidence, and estimated
  acceptance %. Recon artifacts are listed terse and never weigh risk.
- ✅ **Report PAGE mirrors it** (on-screen + print): shared `gradeFindings` helper
  drives both, so the page shows the same Confirmed/Validated/Suspected/
  Informational sections, a "Validated risk N/100" badge, and per-finding state +
  confidence + acceptance %. No drift between screen and export.
- ⬜ Persist `state` + confidence + bbProbability on the Finding model (migration)
  so they're filterable/sortable, not just computed at render.
- ⬜ LIVE threat intel (needs external infra/keys): NVD/MITRE CVE, CISA KEV, EPSS,
  Exploit-DB, OSV, GHSA — version-aware CPE→CVE correlation, exploit-maturity,
  freshness (dismiss patched/EOL), risk = CVSS+EPSS+KEV+impact.
- ✅ **Pipeline triage** grades findings (persists a filterable state category,
  non-destructive) + reports the validated risk; **report stage** summary shows
  validated risk + breakdown (shared `reportSummary`).
- ✅ **Exploit page** regrouped by policy state — "Confirmed & validated" (proven
  or actively demonstrated), public-exploit-ready, and "Suspected" to validate;
  informational/recon artifacts are excluded as exploit targets.
- ⬜ Human-review gate for critical/auth/IDOR/SSRF/RCE before any publish.
- ⬜ Adaptive learning from HackerOne/Bugcrowd outcomes (acceptance/dupe/N-A).
- ⬜ Competitor parity research (Aikido AI-pentest, Synack) → feature gaps.

## O. Engine breadth + comms hardening
- ✅ **More service tools** (apt, server-driven — no runner bump for the tools):
  `onesixtyone` + `snmp-check` (SNMP community/enum), `crackmapexec` (SMB/AD:
  signing/SMBv1/shares/creds), `joomscan` (Joomla). Each with presets, a parser
  (SNMP default-community = validated finding, SMBv1 = high, valid SMB creds =
  critical, Joomla CVEs), and auto-exploit wiring (SNMP→onesixtyone+snmp-check,
  SMB→crackmapexec). Verified via tsx.
- ✅ **Runner↔portal comms**: confirmed already encrypted (HTTPS/TLS, cert-verified
  by urllib; token stored only as a SHA-256 hash). Added an HTTPS-enforcement
  guard (v35): the runner refuses to run against a plaintext `http://` portal
  (localhost exempt) so it can never silently downgrade to cleartext. No change
  to the request/response pipeline.
- ⬜ Optional future: per-tool more presets; pipx-method tools (netexec/arjun).

## N. IoT / connected-device security (over WiFi & LAN)
- ✅ **IoT assessment core** (`lib/iot-core.ts`, pure + tested): classify devices
  (ip-camera / router / printer / NAS / smart-home hub / media-TV / VoIP / generic
  IoT) from ports + service banners + hostname, and raise IoT-specific findings
  (exposed Telnet, RTSP camera streams, unauth MQTT, UPnP/SSDP, CoAP, default-
  credential admin panels, raw printing 9100, plaintext FTP, SNMP public) each with
  hardening advice + an authorized validate/exploit hint.
- ✅ **Auto-wired into the nmap parser**: any nmap network scan now also emits a
  classified device inventory + IoT findings (no new tool/runner change).
- ✅ **"IoT device sweep" nmap preset** (telnet/RTSP/printer/NAS/MQTT/UPnP/Dahua
  ports + -sV) + a discoverability tip on the Network page.
- ⬜ Per-class IoT exploit actions (RTSP path brute, MQTT subscribe, default-cred
  login, PRET for printers, SNMP walk) wired into the exploit engine.
- ⬜ MAC/OUI vendor enrichment in the host parser to sharpen classification.

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
