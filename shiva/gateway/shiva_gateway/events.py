"""Structured events — the gateway's audit log (the SOC pipeline's telemetry)."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Event:
    # "register" (a tools/list was processed) | "call" (a tools/call decision)
    kind: str
    # "allow" | "flag" | "block"
    action: str
    tool: str = ""
    severity: str = "info"
    reasons: list[str] = field(default_factory=list)
    detail: str = ""
    ts: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ts": round(self.ts, 3),
            "kind": self.kind,
            "action": self.action,
            "tool": self.tool,
            "severity": self.severity,
            "reasons": self.reasons,
            "detail": self.detail,
        }


class EventLog:
    """In-memory event sink with a JSON-lines export (SIEM-friendly)."""

    def __init__(self) -> None:
        self.events: list[Event] = []

    def add(self, event: Event) -> Event:
        self.events.append(event)
        return event

    def by_action(self, action: str) -> list[Event]:
        return [e for e in self.events if e.action == action]

    def to_jsonl(self) -> str:
        return "\n".join(json.dumps(e.to_dict()) for e in self.events)
