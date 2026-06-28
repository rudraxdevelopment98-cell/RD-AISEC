"""Render a `ScanReport` as human-readable text or machine-readable JSON."""
from __future__ import annotations

import json

from .models import ScanReport, Severity

# ANSI colours, only used when stdout is a TTY and colour is requested.
_COLORS = {
    Severity.CRITICAL: "\033[1;35m",  # bright magenta
    Severity.HIGH: "\033[1;31m",      # red
    Severity.MEDIUM: "\033[1;33m",    # yellow
    Severity.LOW: "\033[1;36m",       # cyan
    Severity.INFO: "\033[1;90m",      # grey
}
_RESET = "\033[0m"


def to_json(report: ScanReport, indent: int = 2) -> str:
    return json.dumps(report.to_dict(), indent=indent)


def to_text(report: ScanReport, color: bool = False) -> str:
    t = report.target
    lines: list[str] = []
    title = t.name or "(unnamed server)"
    lines.append(f"Shiva scan — {title}")
    lines.append(f"  source : {t.source_kind} · {t.source_ref}")
    lines.append(f"  tools  : {len(t.tools)} ({', '.join(x.name for x in t.tools) or '—'})")

    counts = report.counts()
    summary = " · ".join(
        f"{counts[s.label]} {s.label}" for s in reversed(Severity) if counts[s.label]
    )
    lines.append(f"  result : {summary or 'no findings'}  →  max {report.max_severity.label}")
    lines.append("")

    if not report.findings:
        lines.append("  ✓ no issues found by the current checks")
        return "\n".join(lines)

    for f in report.sorted_findings():
        tag = f.severity.label.upper()
        if color:
            tag = f"{_COLORS.get(f.severity, '')}{tag}{_RESET}"
        scope = f.tool or "<server>"
        lines.append(f"[{tag}] {scope} — {f.title}  ({f.check})")
        if f.detail:
            lines.append(f"    why : {f.detail}")
        if f.evidence:
            lines.append(f"    evid: {f.evidence}")
        if f.recommendation:
            lines.append(f"    fix : {f.recommendation}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"
