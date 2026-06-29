"""The benchmark: each Attack Range server + its known-correct verdict.

Add a row here when you add a server to the Attack Range; the harness scores
the scanner/gateway against it automatically.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Case:
    name: str
    server: str  # filename under shiva/attack-range/
    kind: str  # "malicious" | "benign"
    attack: str  # "poisoning" | "drift" | "escalation" | "none"
    # Scanner check ids that SHOULD fire for a malicious case (any one = detected).
    expect_checks: tuple[str, ...] = ()
    # Tool the gateway should BLOCK in enforce mode, if this attack is a
    # single-tool block (poisoning). "" = not a per-tool runtime block.
    block_tool: str = ""


CASES: list[Case] = [
    Case(
        name="benign baseline",
        server="benign_server.py",
        kind="benign",
        attack="none",
    ),
    Case(
        name="tool poisoning",
        server="poisoned_server.py",
        kind="malicious",
        attack="poisoning",
        expect_checks=("C1-hidden-instructions",),
        block_tool="get_weather",
    ),
    Case(
        name="description drift / rug-pull",
        server="drift_server.py",
        kind="malicious",
        attack="drift",
        expect_checks=("C4-drift-risk",),
    ),
    Case(
        name="cross-tool escalation",
        server="escalation_server.py",
        kind="malicious",
        attack="escalation",
        expect_checks=("C3-dangerous-combo",),
    ),
    Case(
        name="credential exfiltration",
        server="credential_server.py",
        kind="malicious",
        attack="exfiltration",
        expect_checks=("C3-dangerous-combo",),
    ),
]
