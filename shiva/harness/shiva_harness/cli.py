"""Harness CLI — run the benchmark and print the scorecard.

    python -m shiva_harness                 # text scorecard
    python -m shiva_harness --json          # machine-readable
    python -m shiva_harness --range DIR     # point at a custom Attack Range

Exit code 0 when every case passes (full detection, zero false positives),
else 1 — so it doubles as a regression gate in CI.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__, _SHIVA
from . import report as report_mod
from .runner import evaluate, score


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="shiva-harness",
        description="Score the Shiva scanner + gateway against the Attack Range.",
    )
    p.add_argument("--range", default=str(_SHIVA / "attack-range"),
                   help="path to the Attack Range directory")
    p.add_argument("--json", action="store_true", help="emit JSON instead of text")
    p.add_argument("--version", action="version", version=f"shiva-harness {__version__}")
    args = p.parse_args(argv)

    range_dir = Path(args.range)
    if not range_dir.is_dir():
        print(f"shiva-harness: no such range directory: {range_dir}", file=sys.stderr)
        return 2

    results = evaluate(range_dir)
    if args.json:
        print(report_mod.to_json(results))
    else:
        print(report_mod.to_text(results))

    return 0 if score(results)["all_passed"] else 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
