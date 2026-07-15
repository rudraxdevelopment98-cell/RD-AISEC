# RD-AISEC Runner v2 — agent (Phase 0)

The next-gen "operations agent". Where v1 runs one allowlisted command per job,
v2 executes **task graphs** (multi-step operations that chain, pass data, branch,
and pass through an authorization gate) built from **capability modules**.

Full design: [`../../docs/runner-v2-architecture.md`](../../docs/runner-v2-architecture.md).

## Layout

| File | What it is |
|---|---|
| `capabilities.py` | `Capability` + `Registry`. Abilities are pluggable modules, each with an authorization level (`passive`/`active`/`intrusive`). |
| `tasks.py` | The **task engine** — parses a graph, orders steps by dependency, flows data via `$step.output` refs, branches on `when`, enforces the **authorization gate** per target. |
| `channel.py` | How the agent talks to the portal. `PollChannel` (v1-compatible HTTPS poll) now; a `BusChannel` (realtime pub/sub) drops in behind the same interface later. |
| `adapt.py` | v1 drop-in — turns a legacy `(tool,target,args)` job into a one-step task and back into the v1 result shape. |
| `modules.py` | Built-in capabilities: `core.shell`, `core.tool`, `core.findings`, `recon.resolve`. |
| `crypto.py` | `crypto.tls_audit` — weak-crypto detection (OWASP A02) from TLS scan data. |
| `web.py` | `web.security_headers` — missing/weak HTTP security headers + unsafe cookies (OWASP A05). |
| `agent.py` | The agent: PATH self-heal, non-blocking heartbeat, telemetry cache, and the poll→run→post loop. |

## Run it

```bash
PORTAL_URL="https://your-portal"  RUNNER_TOKEN="rdr_…"  python3 agent.py
```

Phase 0 is stdlib-only, so it deploys exactly like v1. It speaks v1's job
endpoints, so today's scans run unchanged while the task engine powers them.

## Tests (all green)

```bash
python3 test_engine.py   # 11 — ordering, data-flow, branching, authz gate, cycle detection
python3 test_adapt.py    # 7  — v1 job → task → v1 result drop-in
python3 test_crypto.py   # 21 — weak-crypto classification + sslscan parse→analyze
python3 test_web.py      # 18 — HTTP hardening gaps, hardened-clean, header-block parse
python3 test_flow.py     # 8  — real multi-step op (resolve→tls_audit→report), gated
```

## A task graph looks like this

```jsonc
{
  "task": "assess-crypto",
  "authorization": { "scope": "acme.io", "grantedBy": "kuldeep" },
  "steps": [
    { "id": "resolve", "use": "recon.resolve",   "in": { "host": "acme.io" } },
    { "id": "tls",     "use": "crypto.tls_audit", "in": { "target": "acme.io" } },
    { "id": "report",  "use": "core.findings",    "in": { "from": "$tls.findings" },
      "when": "$tls.weak > 0" }
  ]
}
```

## Adding a capability

```python
@reg.capability(name="recon.subdomains", authorization="passive",
                inputs={"domain": "str"}, outputs={"hosts": "list[str]"})
def _subs(ctx, inputs):
    ...
    return {"hosts": hosts}
```

That's the whole extension model: new abilities are new modules, no core changes.

## Roadmap (from the design doc)

- **Phase 0 ✅** task engine + capability framework + v1 drop-in + reliability floor
- Phase 1 — realtime bus + live streaming + kill switch + audit
- Phase 2 — interactive sessions (PTY / browser) + artifact transfer
- Phase 3 — network pivoting (SOCKS / forwards / tunnels)
- Phase 4 — capability library depth (crypto ✅ started, exploit, wifi, forensics)
- Phase 5 — AI planner (goal → task graph → execute with approval gates)
- Phase 6 — fleet (multi-agent coordination)
