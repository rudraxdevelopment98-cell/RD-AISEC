"""
End-to-end demonstration of the v2 vision — run:  python3 test_flow.py

A real multi-step operation expressed as ONE task graph:
    resolve (passive)  →  tls_audit (active, gated)  →  report (only if weak)
It proves: data flows between steps, the authorization gate scopes the active
step to the granted domain, and a conditional step fires on a prior result.
No network — the TLS step reuses embedded sslscan output.
"""
import sys
from capabilities import Registry
import modules, crypto
from tasks import TaskGraph, run_task

PASS = FAIL = 0
def ok(c, m):
    global PASS, FAIL
    PASS += c; FAIL += (not c)
    print(("  ✓ " if c else "  ✗ ") + m)

reg = Registry(); modules.register(reg); crypto.register(reg)

SSLSCAN = """
  SSLv3     enabled
  TLSv1.0   enabled
Accepted  TLSv1.0  128 bits  RC4-SHA
  RSA Key Strength:    1024
  Signature Algorithm: sha1WithRSAEncryption
"""

graph = TaskGraph.parse({
    "task": "assess-crypto",
    "authorization": {"scope": "acme.io", "grantedBy": "kuldeep"},
    "steps": [
        {"id": "resolve", "use": "recon.resolve", "in": {"host": "acme.io"}},
        {"id": "tls",     "use": "crypto.tls_audit", "in": {"target": "acme.io", "scan": SSLSCAN}},
        {"id": "report",  "use": "core.findings", "in": {"from": "$tls.findings"},
         "when": "$tls.weak > 0"},
    ],
})

events = []
rep = run_task(graph, reg, emit=lambda e: events.append((e.get("step"), e.get("status"))))

print("multi-step task graph executes in order with data-flow")
ok(rep["resolve"]["status"] in ("done",), "passive recon.resolve ran (no grant needed)")
ok(rep["tls"]["status"] == "done", "active crypto.tls_audit ran (target in scope 'acme.io')")
ok(rep["tls"]["outputs"]["weak"] >= 4, f"tls audit found weaknesses ({rep['tls']['outputs']['weak']})")
ok(rep["report"]["status"] == "done", "conditional report fired (weak > 0)")
ok(rep["report"]["outputs"]["count"] == rep["tls"]["outputs"]["weak"],
   "report aggregated exactly the findings from the tls step (data-flow)")

print("authorization gate scopes the active step to the grant")
bad = TaskGraph.parse({
    "task": "out-of-scope",
    "authorization": {"scope": "acme.io", "grantedBy": "kuldeep"},
    "steps": [{"id": "tls", "use": "crypto.tls_audit", "in": {"target": "someoneelse.com", "scan": SSLSCAN}}],
})
rbad = run_task(bad, reg)
ok(rbad["tls"]["status"] == "refused", "same audit on an OUT-of-scope host is refused")

print("conditional report is skipped when there's nothing to report")
clean = TaskGraph.parse({
    "task": "clean",
    "authorization": {"scope": "secure.io", "grantedBy": "k"},
    "steps": [
        {"id": "tls", "use": "crypto.tls_audit",
         "in": {"target": "secure.io", "scan": "Accepted TLSv1.3 256 bits ECDHE-RSA-AES256-GCM-SHA384\n  RSA Key Strength: 2048"}},
        {"id": "report", "use": "core.findings", "in": {"from": "$tls.findings"}, "when": "$tls.weak > 0"},
    ],
})
rclean = run_task(clean, reg)
ok(rclean["tls"]["outputs"]["weak"] == 0, "strong host → 0 weaknesses")
ok(rclean["report"]["status"] == "skipped", "report skipped when nothing weak")

print(f"\nevent stream: {events}")
print(f"{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
