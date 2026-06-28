"""Gateway policy — what the gateway is allowed to permit or must block.

Kept as plain data so a policy can come from a JSON file, the portal, or code.
"""
from __future__ import annotations

from dataclasses import dataclass, field

MODES = ("monitor", "enforce")


@dataclass
class Policy:
    # "monitor" = detect only (never blocks, just flags + logs).
    # "enforce" = block violations in real time.
    mode: str = "monitor"
    # If set, ONLY these tool names may be called; anything else is a violation.
    allow_tools: list[str] | None = None
    # Tool names that are always forbidden.
    block_tools: list[str] = field(default_factory=list)
    # Treat a description that drifted from its trusted baseline as a violation.
    block_on_drift: bool = True
    # Treat a tool whose description trips the poisoning check (>= severity) as
    # a violation.
    block_on_poison: bool = True
    # Minimum poisoning severity that counts as a violation.
    min_block_severity: str = "high"

    def enforcing(self) -> bool:
        return self.mode == "enforce"

    @classmethod
    def from_dict(cls, data: dict | None) -> "Policy":
        data = data or {}
        p = cls()
        for key in (
            "mode", "allow_tools", "block_tools",
            "block_on_drift", "block_on_poison", "min_block_severity",
        ):
            if key in data and data[key] is not None:
                setattr(p, key, data[key])
        if p.mode not in MODES:
            raise ValueError(f"policy.mode must be one of {MODES}, got {p.mode!r}")
        return p
