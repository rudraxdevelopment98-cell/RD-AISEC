"""Command-line entry point for the Shiva MCP scanner.

Examples:
    shiva-scan poisoned_server.py                  # static scan of source
    shiva-scan tools.json                          # static scan of a manifest
    shiva-scan --live "python poisoned_server.py"  # live MCP introspection
    shiva-scan server.py --json                    # machine-readable output
    shiva-scan server.py --baseline base.json      # drift check vs baseline
    shiva-scan server.py --update-baseline base.json
    shiva-scan server.py --fail-on critical        # CI exit-code threshold
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__, checks, report, static_adapter
from .models import ScanReport, ScanTarget, Severity

_SEV_CHOICES = [s.label for s in Severity]


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="shiva-scan",
        description="Static + live security scanner for MCP servers (the Shiva scanner).",
    )
    p.add_argument("target", help="path to an MCP server .py / .json manifest, "
                                  "or (with --live) the command to start the server")
    p.add_argument("--live", action="store_true",
                   help="introspect a running server over MCP instead of static analysis")
    p.add_argument("--json", action="store_true", help="emit JSON instead of text")
    p.add_argument("--baseline", metavar="FILE",
                   help="compare tool descriptions against this drift baseline")
    p.add_argument("--update-baseline", metavar="FILE",
                   help="write/refresh a drift baseline from this scan and exit")
    p.add_argument("--fail-on", choices=_SEV_CHOICES, default="high",
                   help="exit non-zero if any finding is at/above this severity (default: high)")
    p.add_argument("--no-color", action="store_true", help="disable coloured output")
    p.add_argument("--version", action="version", version=f"shiva-scan {__version__}")
    return p


def _load_target(args: argparse.Namespace) -> ScanTarget:
    if args.live:
        from . import live_adapter  # lazy: avoids importing optional deps otherwise
        return live_adapter.from_command(args.target)
    path = Path(args.target)
    if not path.exists():
        raise FileNotFoundError(f"no such file: {path} (use --live to scan a command)")
    return static_adapter.load(path)


def _load_baseline(path: str) -> dict[str, str]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    hashes = data.get("hashes", data) if isinstance(data, dict) else {}
    return {str(k): str(v) for k, v in hashes.items()}


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    try:
        target = _load_target(args)
    except Exception as exc:  # surface adapter errors cleanly, no traceback
        print(f"shiva-scan: {exc}", file=sys.stderr)
        return 2

    if args.update_baseline:
        payload = {
            "server": target.name,
            "hashes": checks.description_hashes(target),
        }
        Path(args.update_baseline).write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"baseline written: {args.update_baseline} ({len(payload['hashes'])} tools)")
        return 0

    baseline = _load_baseline(args.baseline) if args.baseline else None
    findings = checks.run_all(target, baseline)
    result = ScanReport(target=target, findings=findings)

    if args.json:
        print(report.to_json(result))
    else:
        color = (not args.no_color) and sys.stdout.isatty()
        print(report.to_text(result, color=color))

    threshold = Severity.parse(args.fail_on)
    return 1 if result.max_severity >= threshold and result.findings else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
