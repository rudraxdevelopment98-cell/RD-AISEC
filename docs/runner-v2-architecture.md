# RD-AISEC Runner v2 — "Operations Agent" Architecture

_Design doc / blueprint. Owner: Kuldeep J. Status: proposed._

The current runner (v1) is a **tool-runner**: it polls the portal, runs one
allowlisted command, and posts the output back. It's simple, dependency-free and
safe — but it can't do complex, multi-step, interactive, or networked operations.

Runner v2 is a jump to a real **autonomous operations agent**: you point it at a
goal and it carries out complex operations — interactively, across the network,
composing many steps — with strong authorization controls so all that power stays
on the authorized-security-testing side of the line.

---

## 1. Goals

- **Any operation, not a fixed tool list.** Express work as composable, chained
  steps (a task graph), not one `(tool, args)` call.
- **Real-time + interactive.** Live shells, browser sessions, exploitation flows —
  not just fire-and-forget scans.
- **Reach anywhere it's authorized.** Pivot/tunnel through the runner to internal
  networks, ports and routes the portal can't touch directly.
- **Drive from intent.** Give it a high-level query; it plans and executes, with
  human approval gates on anything impactful.
- **Never break the reliability we earned.** Never false-offline, never stuck, one
  clean instance, self-updating. (v1's hard-won stability is the floor, not the goal.)
- **Safe by construction.** Capability-scoped auth, per-task authorization,
  sandboxing, full audit, kill switch — power *requires* control.

## 2. Why v1 is limited (honest)

| v1 property | Why it was chosen | Why it limits us now |
|---|---|---|
| **Polling** (`GET /job` every Ns) | dead simple, works through NAT | latency; no live control; no interactivity |
| **One allowlisted tool per job** | no injection surface, easy to reason about | can't chain, branch, or do multi-step ops |
| **Stdlib only, no deps** | nothing to install, tiny | can't use websockets, browsers, rich libs |
| **Stateless jobs** | each job independent, easy | no sessions, no held shells, no pivots |
| **Output-only** | simple | can't push payloads / pull loot & artifacts |
| **Single machine** | simple | no fleet, no distributed operations |

## 3. Design principles

1. **Contract-first.** The agent ↔ portal protocol is versioned and explicit.
   v1 and v2 agents can coexist against the same portal during migration.
2. **Capabilities are modules.** Core stays tiny; everything else (recon, exploit,
   crypto, wifi, forensics, tunneling) is a pluggable, sandboxed module.
3. **Everything is a task in a graph.** One uniform model for "run nmap" and for
   "map this environment, find the crypto, and test it."
4. **Authorization is a gate, not a footnote.** Impactful steps don't run without
   an explicit, auditable authorization for that scope.
5. **Reliability is inherited.** Reuse v1's proven pieces: heartbeat that can't
   block, job-reclaim, PATH self-heal, self-update, single-instance service.

## 4. Architecture at a glance

```
            ┌──────────────────────────── PORTAL (Vercel) ───────────────────────────┐
            │  Task API · Approvals · Findings · Audit · Fleet view · Artifact store  │
            └───────────────▲───────────────────────────────────────────▲────────────┘
                            │ (control plane)                            │ (data plane)
                    ┌───────┴────────┐                          ┌────────┴─────────┐
                    │  REALTIME BUS  │  ← persistent, bidi →     │  OBJECT STORAGE   │
                    │ (pub/sub broker)│                          │ (artifacts/loot)  │
                    └───────▲────────┘                          └────────▲─────────┘
                            │  WebSocket / SSE (live)                    │ signed URLs
       ┌────────────────────┴─────────────────────────────────────────── ┴───────────┐
       │  AGENT (Kali)                                                                 │
       │  ┌───────────┐  ┌──────────────┐  ┌───────────────┐  ┌────────────────────┐  │
       │  │  core     │  │ task engine  │  │ session mgr   │  │ capability modules │  │
       │  │ (channel, │→ │ (DAG runner, │→ │ (PTY, browser,│→ │ recon/exploit/     │  │
       │  │  auth,    │  │  data flow,  │  │  C2, DB, tun) │  │ crypto/wifi/pivot… │  │
       │  │  health)  │  │  branching)  │  │               │  │ (sandboxed)        │  │
       │  └───────────┘  └──────────────┘  └───────────────┘  └────────────────────┘  │
       └──────────────────────────────────────────────────────────────────────────────┘
```

### 4a. The one hard infra constraint — solved up front
The portal runs on **Vercel (serverless)**, which **cannot hold long-lived
WebSocket connections**. So the "persistent channel" can't be portal↔agent
directly. The agent connects to a **realtime bus** (a managed pub/sub — e.g.
Supabase Realtime / Ably / Pusher / a small always-on Node gateway on Fly/Render),
and the Vercel portal publishes/subscribes to that bus. This gives us instant,
bidirectional control without asking serverless to do something it can't.
**Fallback:** if no bus is configured, the agent degrades to fast long-poll (still
works, just not sub-second) — so v2 runs even before the bus is stood up.

## 5. The task model (how "any operation" is expressed)

A task is a **DAG of steps**. Each step has a type, inputs (which can reference
prior steps' outputs), an authorization scope, and a handler (a capability module).

```jsonc
{
  "task": "map-and-test-crypto",
  "authorization": { "scope": "acme.io", "grantedBy": "kuldeep", "expiresAt": "…" },
  "steps": [
    { "id": "discover", "use": "recon.subdomains", "in": { "domain": "acme.io" } },
    { "id": "live",     "use": "recon.httpx",      "in": { "hosts": "$discover.hosts" } },
    { "id": "tls",      "use": "crypto.tls_audit", "in": { "urls": "$live.urls" } },
    { "id": "report",   "use": "core.findings",    "in": { "from": "$tls.findings" },
      "when": "$tls.weak > 0" }
  ]
}
```

- **Data flows** between steps (`$step.field`).
- **Branching** via `when`.
- **Any operation** = the union of available capability modules + custom steps.
- The portal (or the AI planner) *composes* these; the agent *executes* them.

## 6. Capability modules (the plugin system)

A module is a small, declared unit the agent loads. Interface (sketch):

```python
class Capability:
    name = "crypto.tls_audit"
    authorization = "active"      # passive | active | intrusive
    inputs  = {"urls": "list[str]"}
    outputs = {"findings": "list[Finding]", "weak": "int"}
    async def run(self, ctx, inputs) -> dict: ...
```

- Modules declare their **authorization level** → the gate knows what needs a grant.
- Modules are **sandboxed** (subprocess + resource/time limits; optionally a
  namespace/container) so a bad module can't take the box down or escape scope.
- New capabilities ship as modules — no core changes, delivered via self-update.
- Planned first modules: `recon.*`, `crypto.*` (your idea), `exploit.*`,
  `wifi.*` (sensing/survey port), `pivot.*`, `forensics.*`, `session.*`.

## 7. Interactive sessions (Tier 2)

The **session manager** holds live, stateful handles the task engine can drive:
- **PTY shell** — an interactive shell on a target (or local), streamed live.
- **Browser** — Playwright/Chromium for auth flows, DOM-level testing, screenshots.
- **C2/agent session** — a persistent implant channel (authorized red-team).
- **DB / service session** — hold a connection across steps.

Sessions get an id; steps attach to them; the realtime bus streams their I/O to the
portal so you can *watch and type into* a live operation.

## 8. Network pivoting — "links, ports, routes" (Tier 2)

The agent becomes a **gateway** into an environment you're authorized in:
- **SOCKS5 proxy** on the agent → the portal/tools route through it to reach hosts
  only the agent can see.
- **Port-forwards** (local/remote) and **tunnels** for reaching internal services.
- **Route/interface awareness** so multi-homed / VPN'd Kali boxes reach the right
  subnets. This is what lets operations reach internal ports & routes the cloud
  portal never could.

## 9. AI planner (Tier 3)

You give a **goal**; a planner (portal-side, using your own AI key) turns it into a
task graph, which the agent executes with approval gates on intrusive steps:

```
"Assess acme.io's external crypto posture and prove any weakness"
  → recon.subdomains → recon.httpx → crypto.tls_audit
  → (weak found) → exploit.crypto_poc  [⏸ needs authorization]
  → core.findings + report
```

This is the "solve any query" layer — but it only ever emits steps the capability
library supports, and impactful steps still stop at the authorization gate.

## 10. Security & guardrails (the pillar, not an afterthought)

- **Capability-scoped tokens** — an agent's token grants only certain capability
  classes; intrusive ones need explicit enablement per machine.
- **Per-task authorization** — an intrusive task carries a signed scope+grant;
  no grant, no run. Mirrors the engagement `authorized` model already in the app.
- **Sandboxing/isolation** — per-task subprocess + rlimits; container/namespace for
  intrusive modules; nothing escapes its declared scope or lifetime.
- **Full audit trail** — every step, input, and output hashed and logged (feeds the
  existing SIEM).
- **Kill switch** — one control that halts all tasks/sessions on a machine instantly.
- **Ethics/legality** — the whole thing stays bound to authorized targets (your
  assets, clients, in-scope programs). Power + authorization = legitimate; power
  without it = the thing we refuse to build.

## 11. Migration from v1 (no big-bang)

1. v2 agent speaks the **v1 job endpoints too**, so existing scans keep working
   from day one.
2. The realtime bus + task engine light up alongside polling; if the bus isn't
   configured, v2 == v1 + task engine over long-poll.
3. Capability modules replace hardcoded tool handling incrementally.
4. When v2 is proven, v1 is retired. Same install/uninstall scripts, same
   self-update — so rollout is one command and updates are automatic.

## 12. Tech choices & tradeoffs

- **Language: Python** (Kali-native, richest security ecosystem) — but v2 **drops
  the stdlib-only rule** and uses a managed **venv** so it can pull `websockets`,
  `playwright`, etc. (self-managed so install stays one command).
- **Realtime bus: managed pub/sub** (evaluate Supabase Realtime vs Ably vs a tiny
  Fly.io gateway) — because Vercel can't hold sockets.
- **Artifacts: object storage** (e.g. the portal's blob store / S3-compatible) with
  signed URLs, so loot/pcaps/screenshots don't go through the DB.
- **Isolation: subprocess + rlimits first**, containers for intrusive modules later.

## 13. Phased roadmap

- **Phase 0 ✅ — Foundation (Tier 1 core).** New agent skeleton: channel abstraction
  (long-poll now, bus-ready), **task engine (DAG runner)**, capability-module
  loader, and the reliability floor (heartbeat, reclaim, PATH, self-update,
  single-instance). Ships doing everything v1 does, via modules. Built + tested in
  `runner/agent/` (task engine, adapter, channel, agent loop).
- **Phase 1 — Realtime bus** + live streaming + the kill switch + audit.
- **Phase 2 — Interactive sessions** (PTY + browser) and **artifact transfer**.
- **Phase 3 — Network pivoting** (SOCKS + forwards + tunnels).
- **Phase 4 — Capability library depth** (crypto ✅ TLS+hash, web ✅ headers,
  wifi ✅ survey; exploit + forensics next).
- **Phase 5 — AI planner** (goal → task graph → execute w/ approval gates).
  **Rule-based core ✅** (`planner.py`: goal→graph, scope-bound, gated); the LLM
  step-selector slots into `planner.plan()` behind the same signature.
- **Phase 6 — Fleet** (multi-agent coordination, distributed tasks).

**Progress (2026-07-15):** Phase 0 foundation complete; Phases 4 & 5 have working
first cuts. Capability set: `core.shell/tool/findings`, `recon.resolve`,
`crypto.tls_audit`, `crypto.hash_audit`, `web.security_headers`, `wifi.survey`.
121 test assertions green (`runner/agent/test_*.py`). All modules are stdlib-only
and pure-analysis where possible, so judgement is tested offline.

**Next:** Phase 1 realtime bus (portal-side pub/sub + `BusChannel`), then Phase 2
interactive sessions. Both need portal changes, so they pair with UI work.
