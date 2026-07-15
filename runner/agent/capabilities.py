"""
Capability framework for Runner v2 — the "operations agent".

A capability is a small, self-declared unit of work (run a tool, open a shell,
audit TLS, pivot a socket…). The task engine composes them into graphs. Core
stays tiny; everything the agent can DO is a capability module, so new abilities
ship without touching the core (and, later, arrive via self-update).

Stdlib only — Phase 0 stays dependency-free so it deploys exactly like v1.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict

# How impactful a capability is — decides what the authorization gate requires.
#   passive   — observe only (DNS lookup, parse) → never needs a grant
#   active    — touches the target non-destructively (scan, probe) → needs scope grant
#   intrusive — could change/exploit (exploit, write, deauth) → needs explicit grant
AUTH_LEVELS = ("passive", "active", "intrusive")


@dataclass
class Capability:
    """One agent ability. `run(ctx, inputs)` returns a dict of named outputs that
    later steps can reference as `$step.output`."""
    name: str
    run: Callable[["ExecContext", Dict[str, Any]], Dict[str, Any]]
    authorization: str = "active"
    inputs: Dict[str, str] = field(default_factory=dict)   # name -> type hint (doc)
    outputs: Dict[str, str] = field(default_factory=dict)
    description: str = ""

    def __post_init__(self) -> None:
        if self.authorization not in AUTH_LEVELS:
            raise ValueError(f"{self.name}: authorization must be one of {AUTH_LEVELS}")


class Registry:
    """Holds the loaded capabilities. The loader registers modules here; the task
    engine looks them up by name."""

    def __init__(self) -> None:
        self._caps: Dict[str, Capability] = {}

    def register(self, cap: Capability) -> None:
        if cap.name in self._caps:
            raise ValueError(f"duplicate capability: {cap.name}")
        self._caps[cap.name] = cap

    def capability(self, **kw):
        """Decorator: register a function as a capability.
        @registry.capability(name="crypto.tls_audit", authorization="active")"""
        def deco(fn: Callable[["ExecContext", Dict[str, Any]], Dict[str, Any]]):
            self.register(Capability(run=fn, **kw))
            return fn
        return deco

    def get(self, name: str) -> Capability:
        cap = self._caps.get(name)
        if cap is None:
            raise KeyError(f"unknown capability: {name}")
        return cap

    def has(self, name: str) -> bool:
        return name in self._caps

    def names(self) -> list[str]:
        return sorted(self._caps)


# Forward ref for the type hint above (defined in tasks.py to avoid a cycle).
class ExecContext:  # pragma: no cover - overwritten by tasks.ExecContext at runtime
    pass
