# Shiva Gateway 🚦

Runtime defense for **MCP tool calls** — the Phase 2 component of
[Shiva](../README.md) (Scanner · **Gateway** · Attack Range).

The [scanner](../scanner) checks a server *before* you trust it. The gateway
sits *between* an agent/client and its MCP servers and, for every tool list and
call, **logs → checks policy → checks drift → decides**:

```
🤖 agent ──▶ 🚦 gateway ──▶ 🔌 MCP servers
              │  log every call (structured events)
              │  policy check (allowlist / blocklist)
              │  drift check  (description changed since trust?)
              │  poison check (hidden-instruction description?)
              ▼
        allow · flag · block
```

**Design rule (from the architecture doc): detect first, enforce later.**
`--mode monitor` only flags + logs (measure your false-positive rate on the
Attack Range first); `--mode enforce` blocks in real time.

Detection is **shared with the scanner** — the gateway reuses
`shiva_scanner.checks`, so it blocks exactly what the scanner flags.

## What it catches

| Threat | How | Attack Range |
|---|---|---|
| **Tool poisoning** | description trips the scanner's hidden-instruction check | `poisoned_server.py` |
| **Rug-pull / drift** | a tool's description changed since it was trusted (baseline or trust-on-first-use) | `drift_server.py` |
| **Out-of-policy calls** | tool not on the allowlist, or explicitly blocked | any |
| **Unknown tools** | a call to a tool never advertised in a tools/list | any |

## Use (replay / policy authoring)

Run from the repo with no install (it finds the sibling scanner automatically):

```bash
cd shiva/gateway

# Monitor: see what WOULD be blocked (never blocks)
python -m shiva_gateway ../attack-range/poisoned_server.py --call get_weather

# Enforce: block the poisoned call (exit code 1)
python -m shiva_gateway ../attack-range/poisoned_server.py --call get_weather --mode enforce

# Allowlist + JSON event log (SIEM-friendly)
python -m shiva_gateway ../attack-range/benign_server.py \
    --call get_weather --call read_file --allow get_weather --mode enforce --json
```

Or install the command: `pip install -e .` → `shiva-gateway ...`

### Drift baseline
Pin trusted descriptions with the scanner, then enforce them at the gateway:

```bash
shiva-scan server.py --update-baseline trusted.json
shiva-gateway server.py --baseline trusted.json --mode enforce --call some_tool
```

## Architecture

```
register_tools(tools)  →  score poisoning (C1) + drift (C4), set trust, log events
authorize_call(tool)   →  Decision(allow|flag|block, reasons, severity) + event
```

`engine.py` is transport-agnostic and fully unit-tested — it's the heart of the
gateway. The CLI above drives it in **replay** mode. A live **stdio proxy**
(client ⇄ gateway ⇄ upstream MCP server, using the MCP SDK) is the next step;
it will be a thin shell over this same engine, so the detection/enforcement
logic is already proven here.

## Test

```bash
python -m unittest discover -s tests
```

> ⚠️ Authorised, educational use only.
