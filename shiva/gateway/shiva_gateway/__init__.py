"""Shiva Gateway — runtime defense for MCP tool calls.

The scanner (../scanner) checks an MCP server *before* you trust it. The
gateway sits *between* an agent/client and its MCP servers at runtime and, for
every tools/list and tools/call, logs a structured event, checks policy
(allowlist), checks description drift since trust, and — in enforce mode —
blocks poisoned/drifted/forbidden calls. Detect first (monitor mode), enforce
later (enforce mode), per the architecture's design rule.

The detection logic is shared with the scanner: the gateway reuses
`shiva_scanner.checks`, so the two stay consistent. To run from the repo
without installing either package, make the sibling scanner importable.
"""
from __future__ import annotations

import pathlib
import sys

__version__ = "0.1.0"

_SCANNER_DIR = pathlib.Path(__file__).resolve().parents[2] / "scanner"
if _SCANNER_DIR.is_dir() and str(_SCANNER_DIR) not in sys.path:
    sys.path.insert(0, str(_SCANNER_DIR))
