"""
Planner — goal → task graph (Runner v2, Phase 5 foundation).

The "solve any query" layer. A user says what they want ("assess crypto on
acme.io", "check acme.io hardening", "full assessment of acme.io") and the
planner composes the registered capabilities into a single authorized task
graph that the engine then runs. Data flows between the steps it picks
(resolve → audit → aggregate), so one goal becomes one coherent operation.

This core is deterministic and rule-based — fully testable offline — and is the
exact shape an LLM planner slots into later: same signature, same output (a task
graph dict), just a smarter step selector. Every plan it emits still passes
through the engine's authorization gate, so a smarter planner can't widen scope.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional


# Intent → the capability step(s) it contributes. Each builder takes the target
# and returns step dicts in `TaskGraph.parse` shape.
def _resolve_step(target: str) -> Dict[str, Any]:
    return {"id": "resolve", "use": "recon.resolve", "in": {"host": target}}


def _tls_step(target: str) -> Dict[str, Any]:
    return {"id": "tls", "use": "crypto.tls_audit", "in": {"target": target}}


def _web_step(target: str) -> Dict[str, Any]:
    return {"id": "web", "use": "web.security_headers", "in": {"url": _as_url(target)}}


def _as_url(target: str) -> str:
    return target if re.match(r"^[a-z][a-z0-9+.\-]*://", target, re.I) else f"https://{target}"


def _host_of(target: str) -> str:
    return re.sub(r"^[a-z][a-z0-9+.\-]*://", "", target.strip(), flags=re.I).split("/")[0].split(":")[0]


# Keyword → intent. Order matters only for reporting; selection is set-based.
_INTENTS = {
    "recon":  ("recon", "resolve", "dns", "lookup", "discover"),
    "crypto": ("crypto", "tls", "ssl", "cipher", "certificate", "cert", "encryption"),
    "web":    ("web", "header", "headers", "hardening", "hsts", "csp", "cookie", "clickjack"),
}
_FULL = ("full", "everything", "complete", "all", "assess", "assessment", "audit", "posture")


def detect_intents(goal: str) -> List[str]:
    """Which capability areas a free-text goal asks for. 'full/assess/audit' →
    all of them. Always includes passive recon as the safe first step."""
    g = (goal or "").lower()
    picked = [name for name, kws in _INTENTS.items() if any(k in g for k in kws)]
    if picked:
        # A specific area was named ("assess crypto") — do just that, plus a cheap
        # passive resolve first. Specific intent wins over the generic 'assess'.
        if "recon" not in picked:
            picked.insert(0, "recon")
    elif any(w in g for w in _FULL):
        picked = ["recon", "crypto", "web"]   # generic 'full/assess/audit' → everything
    else:
        picked = ["recon"]                    # unknown ask → safe, always-authorized thing
    # Stable order: recon, crypto, web.
    return [n for n in ("recon", "crypto", "web") if n in picked]


def plan(goal: str, target: str, grant: Optional[Dict[str, Any]] = None,
         task_name: Optional[str] = None) -> Dict[str, Any]:
    """Compose a goal + target into an authorized task-graph dict.

    grant defaults to a scope covering the target's host, so the plan is
    self-authorized to touch exactly the host it was asked about — nothing wider.
    """
    if not target:
        raise ValueError("plan() needs a target")
    host = _host_of(target)
    intents = detect_intents(goal)

    steps: List[Dict[str, Any]] = []
    finding_refs: List[str] = []
    if "recon" in intents:
        steps.append(_resolve_step(host))
    if "crypto" in intents:
        steps.append(_tls_step(host))
        finding_refs.append("$tls.findings")
    if "web" in intents:
        steps.append(_web_step(target))
        finding_refs.append("$web.findings")

    # A report step aggregates whatever assessment steps produced findings.
    if finding_refs:
        steps.append({"id": "report", "use": "core.findings",
                      "in": {"from": finding_refs}})

    g = grant or {"scope": host, "grantedBy": "planner"}
    return {
        "task": task_name or f"plan:{'+'.join(intents)}",
        "authorization": g,
        "goal": goal,
        "steps": steps,
    }


def explain(plan_dict: Dict[str, Any]) -> str:
    """A one-line human summary of what a plan will do — for the approval gate."""
    steps = plan_dict.get("steps", [])
    uses = " → ".join(s["use"] for s in steps) or "(nothing)"
    scope = (plan_dict.get("authorization") or {}).get("scope", "(unscoped)")
    return f"{plan_dict.get('task')}: {uses}  [scope: {scope}]"
