# Shiva Scanner 🔍

Static **+ live** security scanner for **MCP servers** — the first open-source
component of the [Shiva](../README.md) project (Scanner · Gateway · Attack Range).

It reads an MCP server's tools and descriptions and reports the attacks the
[Attack Range](../attack-range) demonstrates:

| Check | Catches | Attack Range proof |
|---|---|---|
| **C1 — hidden instructions** | imperative / secrecy / smuggled text in a tool *description* | `poisoned_server.py` |
| **C2 — broad permissions** | tools exposing dangerous/unconstrained capabilities (exec, fs, secrets, net) | every server |
| **C3 — dangerous combos** | capability *pairs* that chain into an attack (e.g. network + exec) | `escalation_server.py` |
| **C4 — description drift** | descriptions computed at runtime, or changed vs a saved baseline (rug-pull) | `drift_server.py` |

The static scanner is **stdlib-only** (nothing to install). Live introspection
adds the MCP SDK.

## Install

```bash
cd shiva/scanner
pip install -e .            # installs the `shiva-scan` command
pip install -e ".[live]"   # + the MCP SDK for --live scans
```

Or run with zero install: `python -m shiva_scanner ...`

## Use

```bash
# Static scan of a FastMCP server's source (no code is executed)
shiva-scan ../attack-range/poisoned_server.py

# Static scan of an exported MCP tools/list manifest
shiva-scan tools.json

# Live: actually start the server, introspect it over MCP, scan what it advertises
shiva-scan --live "python ../attack-range/poisoned_server.py"

# Machine-readable output (for CI / the portal)
shiva-scan ../attack-range/poisoned_server.py --json

# Drift baseline: record once, compare later (rug-pull detection)
shiva-scan server.py --update-baseline baseline.json
shiva-scan server.py --baseline baseline.json

# CI gate: exit non-zero if anything is at/above a severity
shiva-scan server.py --fail-on high
```

### Exit codes
`0` clean (or below `--fail-on`) · `1` finding at/above the threshold · `2` error.

This makes it a drop-in CI check:

```yaml
- run: shiva-scan path/to/server.py --fail-on high
```

## How it reads a target

| Input | Adapter | Runs the server? |
|---|---|---|
| `*.py` (FastMCP) | `static_adapter` — Python AST | no |
| `*.json` (tools/list export) | `static_adapter` — manifest | no |
| `--live "<cmd>"` | `live_adapter` — MCP stdio client | yes |

All three normalise to the same `ScanTarget` → the **same checks** run against
each. Static analysis is the safe CI default; live introspection sees what the
server *actually* advertises at runtime.

## Design

```
input (py / json / live)  →  ScanTarget (tools, descriptions, params)
                                  │
                  ┌───────────────┼───────────────┐
                 C1              C2/C3             C4
          hidden instr.     capabilities       drift
                  └───────────────┼───────────────┘
                            ScanReport  →  text | JSON | exit code
```

Detection knowledge lives in [`patterns.py`](shiva_scanner/patterns.py) as data
tables (regexes, capability keywords, dangerous pairs) so new signals are a
one-line addition. The checks in [`checks.py`](shiva_scanner/checks.py) are pure
functions — easy to unit-test against the Attack Range.

## Test

```bash
python -m unittest discover -s tests
```

The tests assert the scanner catches each Attack Range attack and does **not**
over-flag the benign baseline.

> ⚠️ Authorised, educational use only — scan MCP servers you own or are
> permitted to assess.
