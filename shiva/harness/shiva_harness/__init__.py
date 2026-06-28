"""Shiva Harness — score the scanner + gateway against the Attack Range.

Produces a detection-rate / false-positive-rate benchmark: run every Attack
Range server through the scanner (and the gateway in enforce mode) and check
the verdict against the known label for each case. This is the "prove it works"
artifact — and the gateway architecture's rule in practice: *measure the
false-positive rate on the Range before arming any auto-block.*

Runs with no install: it makes the sibling scanner + gateway packages importable.
"""
from __future__ import annotations

import pathlib
import sys

__version__ = "0.1.0"

_SHIVA = pathlib.Path(__file__).resolve().parents[2]  # shiva/
for _sib in ("scanner", "gateway"):
    _p = _SHIVA / _sib
    if _p.is_dir() and str(_p) not in sys.path:
        sys.path.insert(0, str(_p))
