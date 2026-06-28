"""Gateway CLI — replay/simulate a session against the policy engine.

Loads a server's tools (statically, via the scanner's adapters), simulates a
sequence of tool calls, and prints the per-call decisions plus the event log.
This is the offline way to author and test a policy before putting the live
proxy in front of a real agent.

Examples:
    # Detect only (monitor): see what WOULD be flagged
    shiva-gateway ../attack-range/poisoned_server.py --call get_weather

    # Enforce: block the poisoned call
    shiva-gateway ../attack-range/poisoned_server.py --call get_weather --mode enforce

    # Allowlist + JSON event log
    shiva-gateway ../attack-range/benign_server.py --call get_weather \
        --allow get_weather --mode enforce --json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__
from .engine import Gateway
from .policy import Policy


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="shiva-gateway",
        description="Runtime policy/drift defense for MCP tool calls (replay mode).",
    )
    p.add_argument("server", help="MCP server .py / .json manifest to load tools from")
    p.add_argument("--call", action="append", default=[], metavar="TOOL",
                   help="simulate a call to TOOL (repeatable, in order)")
    p.add_argument("--mode", choices=["monitor", "enforce"], default="monitor",
                   help="monitor = detect only (default); enforce = block violations")
    p.add_argument("--allow", action="append", metavar="TOOL",
                   help="allowlist: only these tools may be called (repeatable)")
    p.add_argument("--block", action="append", default=[], metavar="TOOL",
                   help="forbid this tool (repeatable)")
    p.add_argument("--baseline", metavar="FILE",
                   help="trusted description baseline (from shiva-scan --update-baseline)")
    p.add_argument("--json", action="store_true", help="emit the JSON event log")
    p.add_argument("--version", action="version", version=f"shiva-gateway {__version__}")
    return p


def _load_baseline(path: str) -> dict[str, str]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    hashes = data.get("hashes", data) if isinstance(data, dict) else {}
    return {str(k): str(v) for k, v in hashes.items()}


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    # Reuse the scanner's static adapters to load the server's tools.
    from shiva_scanner import static_adapter

    try:
        target = static_adapter.load(args.server)
    except Exception as exc:
        print(f"shiva-gateway: {exc}", file=sys.stderr)
        return 2

    policy = Policy(
        mode=args.mode,
        allow_tools=args.allow,  # None unless --allow given
        block_tools=args.block,
    )
    baseline = _load_baseline(args.baseline) if args.baseline else None
    gw = Gateway(policy=policy, baseline=baseline)
    gw.register_tools(target)

    decisions = [(tool, gw.authorize_call(tool)) for tool in args.call]

    if args.json:
        print(gw.log.to_jsonl())
    else:
        print(f"Shiva Gateway — {target.name or '(unnamed)'}  [{policy.mode}]")
        print(f"  loaded {len(target.tools)} tools: "
              f"{', '.join(t.name for t in target.tools) or '—'}")
        flagged = [e for e in gw.log.by_action("flag") if e.kind == "register"]
        if flagged:
            print("  registration alerts:")
            for e in flagged:
                print(f"    ⚠ {e.tool}: {'; '.join(e.reasons)}")
        if decisions:
            print("  calls:")
            for tool, d in decisions:
                icon = {"allow": "✓", "flag": "⚠", "block": "⛔"}[d.action]
                why = f"  ({'; '.join(d.reasons)})" if d.reasons else ""
                print(f"    {icon} {d.action.upper():5} {tool}{why}")

    blocked = gw.log.by_action("block")
    return 1 if blocked else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
