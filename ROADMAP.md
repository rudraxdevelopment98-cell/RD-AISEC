# RD-AISEC — Roadmap

> **Vision:** an AI Security Operating System — an all-in-one portal for
> authorized penetration testing, digital forensics, and security consulting,
> where the cloud app is the **brain** (plan, store, report, automate) and
> execution happens on infrastructure **you control and are authorized to use**.
>
> **For authorized security testing and education only.**

This document folds the *CTO Master Blueprint v1.1* (the 36-month vision) into a
concrete, buildable plan, and adds the **Runner architecture** — the piece that
lets heavy security tooling (Kali) run safely outside the cloud app.

It is a living document. Check items off as they ship. Anyone (including GitHub
Copilot) should be able to pick the next unchecked item and build it.

---

## How to read this

- ✅ done · 🟡 partial · ⬜ not started
- Each phase lists **concrete tasks**, not just themes.
- Phases are **milestones, not calendar months** — ship in order, not on a clock.
- The **Runner** (below) is the spine of "Tool Execution" and everything in the
  Automation/Agents phases. Build it once; everything above it gets easier.

---

## Where we are today (honest snapshot)

The **MVP phase is essentially complete** and the **Workspace phase has started**.

| Blueprint MVP deliverable | Status | What exists |
|---|---|---|
| Projects | ✅ | Engagements: CRUD, type (pentest/forensics/consulting), status, scope, authorization fields |
| Findings | ✅ | Findings: severity (info→critical), status (open/fixed/accepted/false_positive), recommendations |
| Reports | ✅ | Markdown + print reports per engagement |
| Tool Execution | 🟡 | Passive Auto Scan (single + bulk, single-GET posture check). Real tool execution = the **Runner**, below |

Also already built (early Workspace/Automation pieces):
- 📊 Analytics (cross-engagement severity/status) — early **Monitoring**
- 📦 Resource Vault + Connect-drive (offline files via File System Access API) — early **Assets**
- 🤖 AI Assistant + Knowledge Library (15 topics) — assistant foundation
- 🧬 Shiva MCP-security docs · 🧰 Tool catalog · cinematic UI · secure login (allowlist)

---

## The Runner architecture (the key unlock) 🔑

**Problem:** Vercel is serverless — it cannot run `nmap`, `nuclei`, `metasploit`,
etc. (no long-running processes, no raw sockets). And it *shouldn't* — running
offensive tools from a shared cloud is a legal/safety problem.

**Solution:** split the brain from the hands.

```
┌─────────────────────────┐         ┌──────────────────────────────┐
│  RD-AISEC PORTAL          │  HTTPS  │  KALI in UTM (your SSD)        │
│  (Vercel — control plane) │◄───────►│  "RD-AISEC Runner" (exec plane)│
│  • queues Jobs            │  poll   │  • pulls next Job              │
│  • stores results         │ ──────► │  • runs nmap / nuclei / etc.   │
│  • parses output→Findings │ ◄────── │  • posts output back           │
└─────────────────────────┘ results  └──────────────────────────────┘
```

- **Pull model, not push:** the runner *polls* the portal over HTTPS
  (`GET /api/runner/job`). No inbound ports on the VM, works behind NAT, survives
  the VM changing networks. Authenticates with a revocable **runner token**.
- **Where the hands live is flexible:** today a Kali VM in UTM on your external
  SSD; tomorrow a VPS, a lab box, or a client jump host. The portal doesn't care.

### Hard guardrails (build these in from day one)
1. **Tool allowlist.** The runner only executes known tools with validated args —
   never arbitrary shell. (Allowlist lives in the runner *and* is enforced when a
   job is queued.)
2. **Authorization gate.** A Job can only target a host inside an Engagement that
   has `authorized = true` and a matching `scope`. (Engagement already has these
   fields — reuse them.)
3. **Per-runner token**, revocable, with `lastSeenAt` tracking. Show stale runners
   as offline.
4. **Scope match.** Reject/flag any target not covered by the engagement scope.
5. **Audit trail.** Every Job records who queued it, when, against what, and the
   full command that ran.

### Data model additions (Prisma)
```prisma
model Runner {
  id         String   @id @default(cuid())
  name       String                 // "Kali-UTM-SSD"
  token      String   @unique       // hashed; shown once on creation
  ownerEmail String
  lastSeenAt DateTime?
  createdAt  DateTime @default(now())
  jobs       Job[]
}

model Job {
  id           String   @id @default(cuid())
  engagementId String
  engagement   Engagement @relation(fields: [engagementId], references: [id], onDelete: Cascade)
  runnerId     String?
  runner       Runner?  @relation(fields: [runnerId], references: [id], onDelete: SetNull)
  tool         String                 // "nmap" | "nuclei" | ... (allowlist)
  target       String                 // must match engagement scope
  args         String                 // validated, stored for audit
  status       String   @default("queued") // queued|claimed|running|done|failed|canceled
  output       String   @default("")  // raw tool output (truncated/capped)
  exitCode     Int?
  queuedBy     String                 // user email
  createdAt    DateTime @default(now())
  startedAt    DateTime?
  finishedAt   DateTime?
}
```
> Schema changes need a migration. Without a local DB, generate one with
> `prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel
> prisma/schema.prisma --script` into `prisma/migrations/<ts>_add_runner_job/`.

### API routes (all auth-gated)
- `POST /api/runner/register` — user creates a runner, returns the token **once**.
- `GET  /api/runner/job` — runner polls for the next `queued` job (auth: runner
  token). Atomically marks it `claimed`/`running`, returns tool+target+args.
- `POST /api/runner/job/:id/result` — runner posts output + exitCode (auth: runner
  token). Portal stores it and (later) parses → Findings.
- `POST /api/jobs` — user queues a job for an engagement (auth: session). Enforces
  allowlist + scope match.

### The runner script (lives in Kali, not in Vercel)
- A small **Python or Node** agent: reads `PORTAL_URL` + `RUNNER_TOKEN` from env,
  loops `GET /api/runner/job` → runs the allowlisted tool via subprocess →
  `POST .../result`. Caps output size; honors a per-tool timeout.
- Ships as `runner/` in the repo with a README: how to install in Kali, set env,
  and run as a `systemd`/tmux service.

### Output parsers (Automation phase)
- `nmap -oX` (XML) → open ports/services → Findings.
- `nuclei -json` → templated findings → Findings (map severity).
- Keep parsers pure + unit-testable in `lib/parsers/`.

---

## Phase plan

### Phase 1 — MVP (Projects · Tool Execution · Findings · Reports)
Mostly ✅. Remaining work is the Runner foundation.
- [x] Engagements (Projects)
- [x] Findings
- [x] Reports (Markdown + print)
- [x] Passive Auto Scan (single + bulk)
- [ ] **Runner: `Runner` + `Job` models + migration**
- [ ] **Runner: register / claim / result / queue API routes (auth-gated)**
- [ ] **Runner: minimal Kali agent script (`runner/`) — runs `nmap`, posts back**
- [ ] **Runner: portal UI — "Queue scan" + live job list + output viewer**
- [ ] **Runner: nmap output → Findings parser**

### Phase 2 — Workspace (Assets · Monitoring · Teams)
- [x] Resource Vault (early Assets)
- [x] Analytics (early Monitoring)
- [ ] **Assets model** — track hosts/domains/apps per engagement (separate from
      free-form Resources). Feeds scope + scan targets.
- [ ] **Scan history** — persist scans over time; chart posture trend per asset.
- [ ] **Teams / RBAC** — move beyond the email allowlist to roles
      (owner/analyst/viewer) + per-engagement membership.
- [ ] **Audit log** — record sensitive actions (job queued, finding edited,
      report exported).

### Phase 3 — Automation (Workflows · Notifications · Evidence Engine)
- [ ] **Workflows** — chain jobs: recon → scan → (parse) → report draft.
- [ ] **Notifications** — email/Slack/Discord on job done, new critical finding.
- [ ] **Evidence Engine** — attach evidence to findings with chain-of-custody
      (hash, timestamp, who). Files stay off the DB (Vercel Blob or drive-linked).
- [ ] More output parsers (nuclei, httpx, gobuster, etc.).

### Phase 4 — Agents (Recon · Vuln · Reporting agents)
- [ ] **AI report writer** — draft exec summary from an engagement's findings
      (use the `lib/ai.ts` Claude stub; model `claude-opus-4-8`). *Quick win — can
      pull forward now.*
- [ ] **Recon Agent** — given a scope, the AI plans + queues runner jobs.
- [ ] **Vuln Agent** — triages findings, suggests severity + remediation.
- [ ] **Reporting Agent** — assembles the full report from findings + evidence.

### Phase 5 — ASM (Attack Surface Management)
- [ ] Continuous discovery of an org's external assets (subdomains, IPs, services).
- [ ] Diff over time; alert on new/changed exposure.

### Phase 6 — DevSecOps (GitHub · Semgrep · CodeQL)
- [ ] Connect a repo; run SAST (Semgrep/CodeQL) as runner jobs.
- [ ] Surface code findings alongside engagement findings.

### Phase 7 — Security OS (Cloud Security · Security Graph · Enterprise)
- [ ] Cloud posture (AWS/GCP/Azure read-only checks).
- [ ] **Security Graph** — relate assets, findings, evidence, owners.
- [ ] Enterprise: SSO, multi-tenant orgs, billing.

---

## Quick wins available now (low effort, high signal)
1. **AI report writer** (Phase 4) — already stubbed in `lib/ai.ts`.
2. **"Open from drive" on engagement detail** — extend the existing component.
3. **Scan history** (Phase 2) — first real Monitoring piece.
4. **More knowledge topics** — drop Markdown in `content/topics/`.

---

## Gaps the blueprint doesn't mention (but a security product needs)
- **RBAC + multi-tenancy** (currently an email allowlist, not roles).
- **Audit logging** of sensitive actions.
- **Rules of engagement / authorization** as first-class data (scope, sign-off,
  dates) — partially present on Engagement; formalize before real Tool Execution.
- **Secrets handling** for runner tokens + any tool credentials.
- **Rate limiting** on runner + scan endpoints.

---

## Principles (don't break these)
- The cloud app stays **passive**; all active/offensive execution runs on the
  **Runner**, against **authorized, in-scope** targets only.
- Never commit secrets (`.env` is git-ignored). Don't store files in the DB.
- Auth on every server action and API route. Enums are strings validated in code.
- Keep components small and data-driven; match the surrounding style. See
  `.github/copilot-instructions.md` for full conventions.
