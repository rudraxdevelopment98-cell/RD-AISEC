"""
Tests for the planner — run:  python3 test_planner.py

Proves a free-text goal + target composes into a valid, authorized task graph
that the engine accepts and runs end-to-end, and that the plan's scope is bound
to the requested host (a smarter planner can't widen scope past the gate).
"""
import sys
import planner
import modules, crypto, web
from capabilities import Registry
from tasks import TaskGraph, run_task

PASS = FAIL = 0
def ok(c, m):
    global PASS, FAIL
    PASS += c; FAIL += (not c)
    print(("  ✓ " if c else "  ✗ ") + m)

def step_ids(p): return [s["id"] for s in p["steps"]]
def uses(p): return [s["use"] for s in p["steps"]]

print("intent detection maps goals to capability areas")
ok(planner.detect_intents("assess crypto on acme.io") == ["recon", "crypto"],
   "crypto goal → recon+crypto")
ok(planner.detect_intents("check the security headers") == ["recon", "web"],
   "headers goal → recon+web (recon prepended)")
ok(planner.detect_intents("full assessment") == ["recon", "crypto", "web"],
   "'full' → everything")
ok(planner.detect_intents("do a complete audit") == ["recon", "crypto", "web"],
   "'audit' → everything")
ok(planner.detect_intents("something vague") == ["recon"],
   "unknown ask → safe passive recon only")

print("plan() builds a valid, target-scoped graph")
p = planner.plan("full assessment", "https://acme.io/login")
ok(step_ids(p) == ["resolve", "tls", "web", "report"], f"full plan has all steps ({step_ids(p)})")
ok(p["authorization"]["scope"] == "acme.io", "scope bound to the target host (scheme/path stripped)")
ok(p["steps"][1]["in"]["target"] == "acme.io", "tls step targets the bare host")
ok(p["steps"][2]["in"]["url"] == "https://acme.io/login", "web step keeps the full URL")
ok(p["steps"][-1]["in"]["from"] == ["$tls.findings", "$web.findings"],
   "report aggregates both assessment steps' findings")

print("a crypto-only goal omits the web step")
pc = planner.plan("just check TLS ciphers", "acme.io")
ok(uses(pc) == ["recon.resolve", "crypto.tls_audit", "core.findings"], f"crypto-only plan ({uses(pc)})")

print("recon-only goal produces no report step (nothing to aggregate)")
pr = planner.plan("resolve this host", "acme.io")
ok(step_ids(pr) == ["resolve"], "recon-only → single passive step, no report")

print("the engine accepts and runs a planned graph end-to-end")
reg = Registry(); modules.register(reg); crypto.register(reg); web.register(reg)
p2 = planner.plan("assess crypto", "acme.io")
# Feed the tls step embedded scan data so it needs no network.
p2["steps"][1]["in"]["scan"] = "Accepted TLSv1.0 128 bits RC4-SHA\n  RSA Key Strength: 1024"
graph = TaskGraph.parse(p2)
rep = run_task(graph, reg)
ok(rep["resolve"]["status"] in ("done",), "planned passive recon ran")
ok(rep["tls"]["status"] == "done", "planned active tls step ran (in scope)")
ok(rep["tls"]["outputs"]["weak"] > 0, "planned tls step found weaknesses")
ok(rep["report"]["status"] == "done", "planned report aggregated the findings")

print("a plan cannot touch a host outside the goal's target — gate holds")
bad = planner.plan("assess crypto", "acme.io")
bad["steps"][1]["in"]["target"] = "victim.com"   # tamper: point the active step elsewhere
bad["steps"][1]["in"]["scan"] = "Accepted TLSv1.0 128 bits RC4-SHA"
rbad = run_task(TaskGraph.parse(bad), reg)
ok(rbad["tls"]["status"] == "refused", "tampered off-scope target is refused by the gate")

print("explain() summarises a plan for the approval gate")
line = planner.explain(planner.plan("full assessment", "acme.io"))
ok("acme.io" in line and "recon.resolve" in line, f"explain is human-readable: {line}")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
