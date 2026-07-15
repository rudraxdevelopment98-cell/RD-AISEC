"""
Task engine for Runner v2 — executes a task graph (DAG of steps).

This is the heart of the "any operation" model: instead of one `(tool, args)`
job, a task is a set of steps that reference each other's outputs, run in
dependency order, branch on results, and each pass through an authorization gate
before anything impactful runs.

Pure stdlib, no I/O of its own — capabilities do the work; this just orchestrates.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from capabilities import Registry, Capability  # type: ignore


# ── Data model ───────────────────────────────────────────────────────────────
@dataclass
class Step:
    id: str
    use: str                                 # capability name
    inputs: Dict[str, Any] = field(default_factory=dict)
    when: Optional[str] = None               # gate expression, e.g. "$tls.weak > 0"


@dataclass
class Grant:
    """Authorization attached to a task: which scope is authorized, by whom."""
    scope: str = ""
    granted_by: str = ""

    def covers(self, target: str) -> bool:
        """A grant covers a target if the target is the scope or a sub-domain/host
        of it (simple, conservative suffix match on host boundaries)."""
        if not self.scope or not target:
            return False
        s, t = self.scope.lower().strip(), target.lower().strip()
        return t == s or t.endswith("." + s)


@dataclass
class TaskGraph:
    name: str
    steps: List[Step]
    grant: Grant = field(default_factory=Grant)

    @staticmethod
    def parse(d: Dict[str, Any]) -> "TaskGraph":
        g = d.get("authorization") or {}
        steps = [
            Step(id=s["id"], use=s["use"], inputs=s.get("in", s.get("inputs", {})), when=s.get("when"))
            for s in d.get("steps", [])
        ]
        return TaskGraph(
            name=d.get("task", d.get("name", "task")),
            steps=steps,
            grant=Grant(scope=g.get("scope", ""), granted_by=g.get("grantedBy", g.get("granted_by", ""))),
        )


class ExecContext:
    """Carries per-run state: resolved step outputs + the task's grant + an emit
    hook so the channel can stream progress live."""

    def __init__(self, grant: Grant, emit: Optional[Callable[[dict], None]] = None):
        self.results: Dict[str, Dict[str, Any]] = {}
        self.grant = grant
        self._emit = emit or (lambda _e: None)

    def emit(self, event: dict) -> None:
        try:
            self._emit(event)
        except Exception:  # noqa: BLE001 — telemetry must never break a task
            pass


# ── Reference resolution ($step.field) ───────────────────────────────────────
_REF = re.compile(r"^\$([A-Za-z0-9_\-]+)(?:\.(.+))?$")
_REF_TOKENS = re.compile(r"\$([A-Za-z0-9_\-]+)")


def _dig(obj: Any, path: str) -> Any:
    for part in path.split("."):
        if isinstance(obj, dict):
            obj = obj.get(part)
        elif isinstance(obj, (list, tuple)):
            try:
                obj = obj[int(part)]
            except (ValueError, IndexError):
                return None
        else:
            return None
    return obj


def resolve(value: Any, ctx: ExecContext) -> Any:
    """Resolve $refs in a value (recursing through dicts/lists). A string that IS a
    single reference resolves to the referenced object (keeping its type)."""
    if isinstance(value, str):
        m = _REF.match(value.strip())
        if m:
            step, path = m.group(1), m.group(2)
            out = ctx.results.get(step, {})
            return _dig(out, path) if path else out
        return value
    if isinstance(value, dict):
        return {k: resolve(v, ctx) for k, v in value.items()}
    if isinstance(value, list):
        return [resolve(v, ctx) for v in value]
    return value


def _deps_in(value: Any) -> set[str]:
    """Every step id referenced anywhere inside a value."""
    found: set[str] = set()
    if isinstance(value, str):
        found.update(_REF_TOKENS.findall(value))
    elif isinstance(value, dict):
        for v in value.values():
            found |= _deps_in(v)
    elif isinstance(value, list):
        for v in value:
            found |= _deps_in(v)
    return found


def step_deps(step: Step) -> set[str]:
    d = _deps_in(step.inputs)
    if step.when:
        d |= set(_REF_TOKENS.findall(step.when))
    return d


def topo_order(steps: List[Step]) -> List[Step]:
    """Dependency order (Kahn). Raises on a cycle or a reference to a missing step."""
    ids = {s.id for s in steps}
    by_id = {s.id: s for s in steps}
    deps = {s.id: (step_deps(s) & ids) for s in steps}
    for s in steps:
        missing = step_deps(s) - ids
        if missing:
            raise ValueError(f"step '{s.id}' references unknown step(s): {sorted(missing)}")
    order: List[Step] = []
    ready = [sid for sid in by_id if not deps[sid]]
    seen: set[str] = set()
    while ready:
        sid = ready.pop(0)
        if sid in seen:
            continue
        seen.add(sid)
        order.append(by_id[sid])
        for other, d in deps.items():
            if sid in d:
                d.discard(sid)
                if not d and other not in seen:
                    ready.append(other)
    if len(order) != len(steps):
        raise ValueError("task graph has a cycle")
    return order


# ── Condition evaluation (safe, no eval) ─────────────────────────────────────
_COND = re.compile(r"^\s*(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$")


def _num(x: Any) -> Optional[float]:
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def eval_when(expr: Optional[str], ctx: ExecContext) -> bool:
    """Evaluate a step's `when` gate. Supports a bare `$ref` (truthiness) and simple
    binary comparisons `<lhs> OP <rhs>` where sides may be $refs, numbers or quoted
    strings. No arbitrary code — safe by construction."""
    if not expr:
        return True
    m = _COND.match(expr)
    if not m:
        return bool(resolve(expr.strip(), ctx))
    lhs, op, rhs = m.group(1), m.group(2), m.group(3)

    def side(tok: str) -> Any:
        tok = tok.strip()
        if (tok.startswith('"') and tok.endswith('"')) or (tok.startswith("'") and tok.endswith("'")):
            return tok[1:-1]
        return resolve(tok, ctx)

    a, b = side(lhs), side(rhs)
    na, nb = _num(a), _num(b)
    if na is not None and nb is not None:
        a, b = na, nb
    if op == "==":
        return a == b
    if op == "!=":
        return a != b
    if na is None or nb is None:
        return False
    return {">": na > nb, "<": na < nb, ">=": na >= nb, "<=": na <= nb}[op]


# ── The authorization gate ───────────────────────────────────────────────────
class NotAuthorized(Exception):
    pass


def authorize(cap: Capability, inputs: Dict[str, Any], grant: Grant) -> None:
    """Passive capabilities always run. Active/intrusive ones require the task's
    grant to cover every target host/domain in the step's inputs. This mirrors the
    engagement `authorized` model — no grant, no impactful action."""
    if cap.authorization == "passive":
        return
    targets = _targets_in(inputs)
    if not targets:
        # An active/intrusive step with no discernible target still needs a grant
        # to exist at all (someone authorized this task).
        if not grant.scope:
            raise NotAuthorized(f"{cap.name}: no authorization grant on this task")
        return
    for t in targets:
        if not grant.covers(t):
            raise NotAuthorized(
                f"{cap.name}: target '{t}' is outside the authorized scope "
                f"'{grant.scope or '(none)'}'"
            )


_HOSTISH = re.compile(r"^[a-z0-9.\-]+\.[a-z]{2,}$|^\d{1,3}(\.\d{1,3}){3}$", re.I)


def _targets_in(value: Any) -> set[str]:
    """Best-effort: pull host/domain/IP-looking strings out of a step's inputs so
    the gate can check them against the grant."""
    out: set[str] = set()
    if isinstance(value, str):
        host = re.sub(r"^[a-z][a-z0-9+.\-]*://", "", value.strip(), flags=re.I).split("/")[0].split(":")[0]
        if _HOSTISH.match(host):
            out.add(host)
    elif isinstance(value, dict):
        for v in value.values():
            out |= _targets_in(v)
    elif isinstance(value, list):
        for v in value:
            out |= _targets_in(v)
    return out


# ── Execution ────────────────────────────────────────────────────────────────
def run_task(graph: TaskGraph, registry: Registry, emit: Optional[Callable[[dict], None]] = None) -> Dict[str, Any]:
    """Execute a task graph. Returns a per-step report. Streams step events via
    `emit`. A step whose `when` is false is skipped; a step that fails records the
    error and its dependents are skipped (they can't get their inputs)."""
    ctx = ExecContext(graph.grant, emit)
    order = topo_order(graph.steps)
    report: Dict[str, Any] = {}
    failed: set[str] = set()

    for step in order:
        # Skip if a dependency failed (its outputs won't exist).
        if step_deps(step) & failed:
            report[step.id] = {"status": "skipped", "reason": "dependency failed"}
            ctx.emit({"step": step.id, "status": "skipped"})
            failed.add(step.id)
            continue

        if not eval_when(step.when, ctx):
            report[step.id] = {"status": "skipped", "reason": "condition false"}
            ctx.emit({"step": step.id, "status": "skipped", "reason": "when=false"})
            continue

        try:
            cap = registry.get(step.use)
        except KeyError as e:
            report[step.id] = {"status": "error", "error": str(e)}
            ctx.emit({"step": step.id, "status": "error", "error": str(e)})
            failed.add(step.id)
            continue

        inputs = resolve(step.inputs, ctx)
        try:
            authorize(cap, inputs, graph.grant)
        except NotAuthorized as e:
            report[step.id] = {"status": "refused", "error": str(e)}
            ctx.emit({"step": step.id, "status": "refused", "error": str(e)})
            failed.add(step.id)
            continue

        ctx.emit({"step": step.id, "status": "running", "use": cap.name})
        try:
            out = cap.run(ctx, inputs) or {}
            ctx.results[step.id] = out
            report[step.id] = {"status": "done", "outputs": out}
            ctx.emit({"step": step.id, "status": "done"})
        except Exception as e:  # noqa: BLE001 — one step's failure isn't fatal
            report[step.id] = {"status": "error", "error": str(e)}
            ctx.emit({"step": step.id, "status": "error", "error": str(e)})
            failed.add(step.id)

    return report
