"""Core data model for the Shiva MCP scanner.

A scan normalises any input (static Python source, a JSON tools manifest, or a
live MCP server) into a small, uniform shape — `ScanTarget` holding a list of
`Tool`s — and the checks run against that shape. Keeping the model independent
of the input format is what lets the static and live adapters share one engine.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import IntEnum
from typing import Any


class Severity(IntEnum):
    """Ordered so findings sort and thresholds compare numerically."""

    INFO = 0
    LOW = 1
    MEDIUM = 2
    HIGH = 3
    CRITICAL = 4

    @classmethod
    def parse(cls, name: str) -> "Severity":
        try:
            return cls[name.strip().upper()]
        except KeyError as exc:  # pragma: no cover - guarded by argparse choices
            raise ValueError(f"unknown severity: {name!r}") from exc

    @property
    def label(self) -> str:
        return self.name.lower()


@dataclass
class ToolParam:
    """One input parameter of a tool."""

    name: str
    annotation: str = ""  # best-effort type as text ("str", "int", ...)


@dataclass
class Tool:
    """A single MCP tool, normalised across every input adapter."""

    name: str
    description: str = ""
    params: list[ToolParam] = field(default_factory=list)
    # True when the description is not a static literal (e.g. computed at
    # runtime via `@mcp.tool(description=some_call())`). A description that the
    # server can change after registration is a drift risk on its own.
    description_dynamic: bool = False
    # Free-form note on where the description came from (for evidence).
    description_source: str = ""
    # Source location for static scans, e.g. "poisoned_server.py:32".
    location: str = ""

    def param_names(self) -> list[str]:
        return [p.name for p in self.params]


@dataclass
class ScanTarget:
    """Everything the checks need to know about one MCP server."""

    name: str = ""
    tools: list[Tool] = field(default_factory=list)
    # How this target was produced: "static" | "manifest" | "live".
    source_kind: str = ""
    source_ref: str = ""  # path or command


@dataclass
class Finding:
    """A single issue raised by a check."""

    check: str  # check id, e.g. "C1-hidden-instructions"
    severity: Severity
    tool: str  # tool name, or "" for server-level findings
    title: str
    detail: str = ""
    evidence: str = ""
    recommendation: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "check": self.check,
            "severity": self.severity.label,
            "tool": self.tool,
            "title": self.title,
            "detail": self.detail,
            "evidence": self.evidence,
            "recommendation": self.recommendation,
        }


@dataclass
class ScanReport:
    """The full result of scanning one target."""

    target: ScanTarget
    findings: list[Finding] = field(default_factory=list)

    @property
    def max_severity(self) -> Severity:
        return max((f.severity for f in self.findings), default=Severity.INFO)

    def counts(self) -> dict[str, int]:
        out = {s.label: 0 for s in Severity}
        for f in self.findings:
            out[f.severity.label] += 1
        return out

    def sorted_findings(self) -> list[Finding]:
        # Highest severity first, then by check id for stable output.
        return sorted(self.findings, key=lambda f: (-int(f.severity), f.check, f.tool))

    def to_dict(self) -> dict[str, Any]:
        return {
            "target": {
                "name": self.target.name,
                "source_kind": self.target.source_kind,
                "source_ref": self.target.source_ref,
                "tool_count": len(self.target.tools),
                "tools": [t.name for t in self.target.tools],
            },
            "max_severity": self.max_severity.label,
            "counts": self.counts(),
            "findings": [f.to_dict() for f in self.sorted_findings()],
        }
