"""
Tests for the Runner v2 task engine — run with:  python3 test_engine.py
Proves the core Phase-0 guarantees: dependency ordering, $ref data-flow,
conditional branching, and the authorization gate. Stdlib only, no network.
"""
import sys

from capabilities import Registry
from tasks import TaskGraph, run_task, topo_order, resolve, ExecContext, Grant, eval_when

PASS, FAIL = 0, 0


def ok(cond, msg):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✓ {msg}")
    else:
        FAIL += 1
        print(f"  ✗ {msg}")


def build_registry():
    reg = Registry()

    @reg.capability(name="gen.list", authorization="passive")
    def _list(ctx, i):
        return {"items": i.get("items", []), "n": len(i.get("items", []))}

    @reg.capability(name="gen.double", authorization="passive")
    def _double(ctx, i):
        return {"value": (i.get("value") or 0) * 2}

    @reg.capability(name="gen.attack", authorization="intrusive")
    def _attack(ctx, i):
        return {"hit": i.get("target")}
    return reg


print("engine: dependency ordering + data-flow")
reg = build_registry()
graph = TaskGraph.parse({
    "task": "flow",
    "steps": [
        {"id": "a", "use": "gen.list", "in": {"items": [1, 2, 3]}},
        {"id": "b", "use": "gen.double", "in": {"value": "$a.n"}},   # depends on a
    ],
})
order = [s.id for s in topo_order(graph.steps)]
ok(order == ["a", "b"], f"topo order a→b (got {order})")
rep = run_task(graph, reg)
ok(rep["a"]["outputs"]["n"] == 3, "step a produced n=3")
ok(rep["b"]["outputs"]["value"] == 6, "step b doubled $a.n → 6 (data-flow works)")

print("engine: conditional branching (when)")
ctx = ExecContext(Grant())
ctx.results = {"tls": {"weak": 2}}
ok(eval_when("$tls.weak > 0", ctx) is True, "'$tls.weak > 0' → True when weak=2")
ctx.results = {"tls": {"weak": 0}}
ok(eval_when("$tls.weak > 0", ctx) is False, "'$tls.weak > 0' → False when weak=0")
graph2 = TaskGraph.parse({
    "task": "branch",
    "steps": [
        {"id": "tls", "use": "gen.list", "in": {"items": []}},
        {"id": "act", "use": "gen.double", "in": {"value": 5}, "when": "$tls.n > 0"},
    ],
})
rep2 = run_task(graph2, reg)
ok(rep2["act"]["status"] == "skipped", "branch step skipped when condition false")

print("engine: authorization gate")
# intrusive step, target in scope → allowed
g_ok = TaskGraph.parse({
    "task": "authz-ok",
    "authorization": {"scope": "acme.io", "grantedBy": "kuldeep"},
    "steps": [{"id": "x", "use": "gen.attack", "in": {"target": "api.acme.io"}}],
})
r_ok = run_task(g_ok, reg)
ok(r_ok["x"]["status"] == "done", "intrusive step on in-scope target (api.acme.io) runs")

# intrusive step, target OUT of scope → refused
g_no = TaskGraph.parse({
    "task": "authz-no",
    "authorization": {"scope": "acme.io", "grantedBy": "kuldeep"},
    "steps": [{"id": "x", "use": "gen.attack", "in": {"target": "victim.com"}}],
})
r_no = run_task(g_no, reg)
ok(r_no["x"]["status"] == "refused", "intrusive step on OUT-of-scope target (victim.com) refused")

# intrusive step, NO grant at all → refused
g_none = TaskGraph.parse({
    "task": "authz-none",
    "steps": [{"id": "x", "use": "gen.attack", "in": {"target": "acme.io"}}],
})
r_none = run_task(g_none, reg)
ok(r_none["x"]["status"] == "refused", "intrusive step with no grant refused")

print("engine: cycle + missing-ref detection")
try:
    topo_order(TaskGraph.parse({"task": "c", "steps": [
        {"id": "a", "use": "gen.list", "in": {"x": "$b.y"}},
        {"id": "b", "use": "gen.list", "in": {"x": "$a.y"}},
    ]}).steps)
    ok(False, "cycle raises")
except ValueError:
    ok(True, "cycle detected")
try:
    topo_order(TaskGraph.parse({"task": "m", "steps": [
        {"id": "a", "use": "gen.list", "in": {"x": "$ghost.y"}},
    ]}).steps)
    ok(False, "missing ref raises")
except ValueError:
    ok(True, "reference to unknown step detected")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
