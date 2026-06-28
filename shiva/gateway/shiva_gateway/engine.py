"""The gateway engine — the testable heart of the runtime defense.

Transport-agnostic: feed it the tools a server advertises (`register_tools`)
and the calls an agent attempts (`authorize_call`); it returns a Decision and
records an Event for each. A real stdio/HTTP proxy is just a thin shell that
drives this engine (see proxy.py / the README).

Detection is shared with the scanner: poisoning + drift come straight from
`shiva_scanner.checks`, so the gateway blocks exactly what the scanner flags.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from shiva_scanner import checks
from shiva_scanner.models import ScanTarget, Severity

from .events import Event, EventLog
from .policy import Policy


@dataclass
class Decision:
    action: str  # "allow" | "flag" | "block"
    reasons: list[str] = field(default_factory=list)
    severity: Severity = Severity.INFO

    @property
    def allowed(self) -> bool:
        return self.action != "block"


class Gateway:
    """Stateful policy + drift enforcement across a session.

    `baseline` maps tool name -> trusted sha256(description). When omitted, the
    gateway trusts each description on first sight (trust-on-first-use) and
    flags any later change — catching a live rug-pull.
    """

    def __init__(self, policy: Policy | None = None, baseline: dict[str, str] | None = None):
        self.policy = policy or Policy()
        self.baseline = dict(baseline) if baseline else None
        self.log = EventLog()
        self._known: set[str] = set()
        self._trusted: dict[str, str] = dict(self.baseline) if self.baseline else {}
        self._drifted: set[str] = set()
        self._poison: dict[str, Severity] = {}

    # -- ingest what a server advertises ------------------------------------ #
    def register_tools(self, target: ScanTarget) -> list[Event]:
        """Process a tools/list: score poisoning, detect drift, set trust."""
        findings = checks.run_all(target, self.baseline)
        for f in findings:
            if f.check == "C1-hidden-instructions":
                self._poison[f.tool] = max(
                    self._poison.get(f.tool, Severity.INFO), f.severity
                )

        hashes = checks.description_hashes(target)
        events: list[Event] = []
        for tool in target.tools:
            name = tool.name
            self._known.add(name)
            digest = hashes.get(name, "")
            trusted = self._trusted.get(name)

            reasons: list[str] = []
            severity = Severity.INFO
            if trusted is not None and trusted != digest:
                self._drifted.add(name)
                reasons.append("description drifted from trusted baseline")
                severity = max(severity, Severity.HIGH)
            elif trusted is None:
                # Trust-on-first-use (only when we have no external baseline).
                if self.baseline is None:
                    self._trusted[name] = digest
                else:
                    reasons.append("tool not present in approved baseline")
                    severity = max(severity, Severity.MEDIUM)

            poison = self._poison.get(name)
            if poison is not None and poison >= Severity.MEDIUM:
                reasons.append(f"poisoned description ({poison.label})")
                severity = max(severity, poison)

            action = "flag" if reasons else "allow"
            ev = Event(
                kind="register", action=action, tool=name,
                severity=severity.label, reasons=reasons,
                detail=tool.description_source,
            )
            events.append(self.log.add(ev))
        return events

    # -- authorize an attempted call ---------------------------------------- #
    def authorize_call(self, tool: str, args: dict | None = None) -> Decision:
        reasons: list[str] = []
        severity = Severity.INFO
        violation = False

        if tool not in self._known:
            reasons.append("unknown tool (never advertised in a tools/list)")
            severity = max(severity, Severity.MEDIUM)
            violation = True

        if self.policy.allow_tools is not None and tool not in self.policy.allow_tools:
            reasons.append("tool not in allowlist")
            severity = max(severity, Severity.HIGH)
            violation = True

        if tool in self.policy.block_tools:
            reasons.append("tool explicitly blocked by policy")
            severity = max(severity, Severity.HIGH)
            violation = True

        if self.policy.block_on_drift and tool in self._drifted:
            reasons.append("description drifted since trust (possible rug-pull)")
            severity = max(severity, Severity.HIGH)
            violation = True

        poison = self._poison.get(tool)
        if (
            self.policy.block_on_poison
            and poison is not None
            and poison >= Severity.parse(self.policy.min_block_severity)
        ):
            reasons.append(f"poisoned description ({poison.label})")
            severity = max(severity, poison)
            violation = True

        if violation:
            action = "block" if self.policy.enforcing() else "flag"
        elif reasons:
            action = "flag"
        else:
            action = "allow"

        self.log.add(Event(
            kind="call", action=action, tool=tool,
            severity=severity.label, reasons=reasons,
        ))
        return Decision(action=action, reasons=reasons, severity=severity)
