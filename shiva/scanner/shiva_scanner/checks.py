"""The detection engine: four checks over a normalised `ScanTarget`.

C1  hidden / imperative instructions in tool descriptions   (catches poisoning)
C2  over-broad / dangerous tool permissions                 (per-tool surface)
C3  dangerous capability combinations                       (catches escalation surface)
C4  description integrity / drift                            (catches rug-pull)

Every check is a pure function: target (+ optional baseline) in, findings out.
"""
from __future__ import annotations

import hashlib

from . import patterns
from .models import Finding, ScanTarget, Severity, Tool


def infer_capabilities(tool: Tool) -> set[str]:
    """Best-effort set of capability tags for a tool, from its name + params.

    Descriptions are intentionally NOT used here: a poisoned description should
    not let an attacker hide a tool's real capability, and using description
    text would make the capability checks noisy. Names and params are what the
    runtime actually exposes.
    """
    haystack = [tool.name.lower(), *[p.name.lower() for p in tool.params]]
    caps: set[str] = set()
    for cap, keywords in patterns.CAPABILITY_KEYWORDS.items():
        for kw in keywords:
            if any(kw == token or kw in token for token in haystack):
                caps.add(cap)
                break
    return caps


def _severity_from_score(score: int) -> Severity:
    if score >= 6:
        return Severity.CRITICAL
    if score >= 4:
        return Severity.HIGH
    if score >= 2:
        return Severity.MEDIUM
    return Severity.LOW


def check_hidden_instructions(target: ScanTarget) -> list[Finding]:
    """C1 — imperative / secrecy / smuggled instructions inside descriptions."""
    findings: list[Finding] = []
    for tool in target.tools:
        desc = tool.description or ""
        if not desc.strip():
            continue
        score = 0
        hits: list[str] = []
        for pattern, weight, label in patterns.INSTRUCTION_PATTERNS:
            if pattern.search(desc):
                score += weight
                hits.append(label)
        # Encoded blobs and invisible characters are independent strong signals.
        if patterns.BASE64_BLOB.search(desc):
            score += 2
            hits.append("long encoded blob")
        if patterns.INVISIBLE_CHARS.search(desc):
            score += 3
            hits.append("invisible/zero-width characters")
        if not hits:
            continue
        findings.append(
            Finding(
                check="C1-hidden-instructions",
                severity=_severity_from_score(score),
                tool=tool.name,
                title="Tool description contains hidden or imperative instructions",
                detail=(
                    "A tool description is metadata the user rarely sees but the "
                    "model treats as trusted context. This description steers the "
                    "model rather than just describing the tool — the hallmark of "
                    "tool poisoning."
                ),
                evidence="; ".join(sorted(set(hits))) + _excerpt(desc),
                recommendation=(
                    "Treat tool descriptions as untrusted. Strip markup/comments, "
                    "reject imperative or secrecy language, and pin the description "
                    "to a reviewed baseline (see C4)."
                ),
            )
        )
    return findings


def check_broad_permissions(target: ScanTarget) -> list[Finding]:
    """C2 — individual tools exposing dangerous / unconstrained capabilities."""
    findings: list[Finding] = []
    for tool in target.tools:
        caps = infer_capabilities(tool)
        for cap in caps:
            if cap not in patterns.CAPABILITY_RISK:
                continue
            label, sev_name = patterns.CAPABILITY_RISK[cap]
            severity = Severity.parse(sev_name)
            # Escalate when an unconstrained param makes the target attacker-chosen.
            unconstrained = [
                p.name
                for p in tool.params
                if p.name.lower() in patterns.UNCONSTRAINED_PARAMS.get(cap, [])
            ]
            evidence = f"capability inferred from name/params: {cap}"
            if unconstrained:
                if severity < Severity.CRITICAL:
                    severity = Severity(min(int(severity) + 1, int(Severity.CRITICAL)))
                evidence += f"; unconstrained param(s): {', '.join(unconstrained)}"
            findings.append(
                Finding(
                    check="C2-broad-permissions",
                    severity=severity,
                    tool=tool.name,
                    title=f"Tool exposes {label}",
                    detail=(
                        "This tool grants a powerful capability. On its own that may "
                        "be legitimate, but it widens blast radius if the agent is "
                        "tricked into calling it."
                    ),
                    evidence=evidence,
                    recommendation=(
                        "Constrain the capability: validate/allowlist arguments "
                        "(paths, hosts, commands), drop unused tools, and require "
                        "human approval for high-impact calls."
                    ),
                )
            )
    return findings


def check_dangerous_combos(target: ScanTarget) -> list[Finding]:
    """C3 — server-level capability pairs that together enable an attack chain."""
    findings: list[Finding] = []
    # Map capability -> tools that provide it, for evidence.
    providers: dict[str, list[str]] = {}
    for tool in target.tools:
        for cap in infer_capabilities(tool):
            providers.setdefault(cap, []).append(tool.name)

    for cap_a, cap_b, sev_name, why in patterns.DANGEROUS_COMBOS:
        if cap_a in providers and cap_b in providers:
            tools_a = ", ".join(sorted(set(providers[cap_a])))
            tools_b = ", ".join(sorted(set(providers[cap_b])))
            findings.append(
                Finding(
                    check="C3-dangerous-combo",
                    severity=Severity.parse(sev_name),
                    tool="",  # server-level
                    title=f"Dangerous capability combination: {cap_a} + {cap_b}",
                    detail=why,
                    evidence=f"{cap_a}: [{tools_a}] + {cap_b}: [{tools_b}]",
                    recommendation=(
                        "Separate these capabilities across trust boundaries, or "
                        "gate the chain (e.g. never let fetched/file content flow "
                        "into an exec or network-send tool unattended)."
                    ),
                )
            )
    return findings


def check_description_integrity(
    target: ScanTarget, baseline: dict[str, str] | None = None
) -> list[Finding]:
    """C4 — descriptions that can drift (dynamic) or have drifted (vs baseline).

    `baseline` maps tool name -> sha256 of its description. When provided, any
    changed/added/removed tool is a drift finding (the rug-pull defence).
    When absent, a description that is computed at runtime is flagged as a
    drift *risk* — it can change after the user approves the tool.
    """
    findings: list[Finding] = []

    for tool in target.tools:
        if tool.description_dynamic:
            findings.append(
                Finding(
                    check="C4-drift-risk",
                    severity=Severity.HIGH,
                    tool=tool.name,
                    title="Tool description is computed at runtime (drift risk)",
                    detail=(
                        "The description is not a fixed literal; the server can "
                        "change it after the user has approved the tool. This is "
                        "the rug-pull / description-drift vector."
                    ),
                    evidence=tool.description_source or "non-literal description expression",
                    recommendation=(
                        "Pin descriptions to reviewed, static text and hash them. "
                        "Re-prompt for approval whenever a description changes."
                    ),
                )
            )

    if baseline is not None:
        current = description_hashes(target)
        seen = set()
        for name, digest in current.items():
            seen.add(name)
            if name not in baseline:
                findings.append(
                    Finding(
                        check="C4-drift",
                        severity=Severity.MEDIUM,
                        tool=name,
                        title="New tool not present in baseline",
                        detail="A tool appeared that was not in the approved baseline.",
                        evidence=f"sha256={digest[:16]}…",
                        recommendation="Review and re-approve before trusting the new tool.",
                    )
                )
            elif baseline[name] != digest:
                findings.append(
                    Finding(
                        check="C4-drift",
                        severity=Severity.HIGH,
                        tool=name,
                        title="Tool description changed since baseline (drift)",
                        detail=(
                            "The tool's description no longer matches the approved "
                            "baseline — a silent rug-pull."
                        ),
                        evidence=f"baseline={baseline[name][:16]}… now={digest[:16]}…",
                        recommendation="Block the tool and require explicit re-approval.",
                    )
                )
        for name in baseline:
            if name not in seen:
                findings.append(
                    Finding(
                        check="C4-drift",
                        severity=Severity.LOW,
                        tool=name,
                        title="Tool from baseline is gone",
                        detail="A previously approved tool disappeared.",
                        evidence="present in baseline, absent now",
                        recommendation="Confirm the removal was intended.",
                    )
                )
    return findings


def description_hashes(target: ScanTarget) -> dict[str, str]:
    """sha256 of each tool's description, keyed by tool name (for baselines)."""
    out: dict[str, str] = {}
    for tool in target.tools:
        digest = hashlib.sha256((tool.description or "").encode("utf-8")).hexdigest()
        out[tool.name] = digest
    return out


def run_all(target: ScanTarget, baseline: dict[str, str] | None = None) -> list[Finding]:
    """Run every check and return the combined findings."""
    findings: list[Finding] = []
    findings += check_hidden_instructions(target)
    findings += check_broad_permissions(target)
    findings += check_dangerous_combos(target)
    findings += check_description_integrity(target, baseline)
    return findings


def _excerpt(desc: str, limit: int = 160) -> str:
    snippet = " ".join(desc.split())
    if len(snippet) > limit:
        snippet = snippet[:limit] + "…"
    return f" — “{snippet}”"
