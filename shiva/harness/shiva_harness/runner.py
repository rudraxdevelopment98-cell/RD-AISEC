"""Run the scanner (and gateway) over every case and score the results."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from shiva_scanner import checks, static_adapter
from shiva_scanner.models import Severity
from shiva_gateway.engine import Gateway
from shiva_gateway.policy import Policy

from .cases import CASES, Case


@dataclass
class CaseResult:
    case: Case
    max_severity: Severity
    fired_checks: set[str]
    detected: bool  # malicious: an expected check fired
    false_positive: bool  # benign: flagged HIGH+
    gateway_blocked: bool | None  # enforce-mode block of block_tool, or None

    @property
    def passed(self) -> bool:
        if self.case.kind == "malicious":
            ok = self.detected
            if self.case.block_tool:
                ok = ok and bool(self.gateway_blocked)
            return ok
        return not self.false_positive


def evaluate(range_dir: str | Path) -> list[CaseResult]:
    range_dir = Path(range_dir)
    results: list[CaseResult] = []
    for case in CASES:
        target = static_adapter.load(range_dir / case.server)
        findings = checks.run_all(target)
        fired = {f.check for f in findings}
        max_sev = max((f.severity for f in findings), default=Severity.INFO)

        if case.kind == "malicious":
            detected = any(c in fired for c in case.expect_checks)
            false_positive = False
        else:
            detected = False
            false_positive = max_sev >= Severity.HIGH

        gateway_blocked: bool | None = None
        if case.block_tool:
            gw = Gateway(Policy(mode="enforce"))
            gw.register_tools(target)
            gateway_blocked = not gw.authorize_call(case.block_tool).allowed

        results.append(
            CaseResult(case, max_sev, fired, detected, false_positive, gateway_blocked)
        )
    return results


def score(results: list[CaseResult]) -> dict:
    malicious = [r for r in results if r.case.kind == "malicious"]
    benign = [r for r in results if r.case.kind == "benign"]
    detected = sum(1 for r in malicious if r.detected)
    fps = sum(1 for r in benign if r.false_positive)
    by_class: dict[str, dict[str, int]] = {}
    for r in malicious:
        b = by_class.setdefault(r.case.attack, {"total": 0, "detected": 0})
        b["total"] += 1
        b["detected"] += int(r.detected)
    return {
        "malicious": len(malicious),
        "detected": detected,
        "detection_rate": detected / len(malicious) if malicious else 0.0,
        "benign": len(benign),
        "false_positives": fps,
        "fp_rate": fps / len(benign) if benign else 0.0,
        "by_attack_class": by_class,
        "all_passed": all(r.passed for r in results),
    }
