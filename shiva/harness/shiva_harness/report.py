"""Render the benchmark as text or JSON."""
from __future__ import annotations

import json

from .runner import CaseResult, score


def to_json(results: list[CaseResult], indent: int = 2) -> str:
    s = score(results)
    s["cases"] = [
        {
            "name": r.case.name,
            "kind": r.case.kind,
            "attack": r.case.attack,
            "max_severity": r.max_severity.label,
            "fired_checks": sorted(r.fired_checks),
            "detected": r.detected,
            "false_positive": r.false_positive,
            "gateway_blocked": r.gateway_blocked,
            "passed": r.passed,
        }
        for r in results
    ]
    return json.dumps(s, indent=indent)


def to_text(results: list[CaseResult]) -> str:
    s = score(results)
    lines = ["Shiva Harness — detection benchmark vs the Attack Range", ""]
    lines.append(f"  {'case':<28} {'label':<10} {'maxsev':<9} {'gateway':<9} result")
    lines.append("  " + "-" * 70)
    for r in results:
        gw = "—" if r.gateway_blocked is None else ("BLOCK" if r.gateway_blocked else "allow")
        verdict = "✓ pass" if r.passed else "✗ FAIL"
        lines.append(
            f"  {r.case.name:<28} {r.case.kind:<10} {r.max_severity.label:<9} {gw:<9} {verdict}"
        )
    lines.append("")
    lines.append(
        f"  Detection rate : {s['detected']}/{s['malicious']} "
        f"({s['detection_rate']*100:.0f}%) of malicious servers caught"
    )
    lines.append(
        f"  False positives: {s['false_positives']}/{s['benign']} "
        f"({s['fp_rate']*100:.0f}%) of benign servers wrongly flagged"
    )
    if s["by_attack_class"]:
        parts = [
            f"{cls} {b['detected']}/{b['total']}"
            for cls, b in sorted(s["by_attack_class"].items())
        ]
        lines.append("  By attack class: " + " · ".join(parts))
    lines.append("")
    lines.append("  " + ("✓ all cases passed" if s["all_passed"] else "✗ some cases FAILED"))
    return "\n".join(lines) + "\n"
