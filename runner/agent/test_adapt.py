"""v1 drop-in tests — run:  python3 test_adapt.py"""
import sys

from capabilities import Registry
import modules
from adapt import job_to_task, result_from_report
from tasks import run_task, topo_order

PASS = FAIL = 0
def ok(c, m):
    global PASS, FAIL
    PASS += c; FAIL += (not c)
    print(("  ✓ " if c else "  ✗ ") + m)

reg = Registry(); modules.register(reg)
TOOLS = {
    "nmap": {"bin": "nmap", "flag": None},
    "httpx": {"bin": "httpx", "flag": "-u"},
}

print("adapter: builds the right task for each job type")
t = job_to_task({"tool": "custom", "args": "echo hello world"}, TOOLS)
ok(t.steps[0].use == "core.shell", "custom job → core.shell")

t = job_to_task({"tool": "nmap", "target": "https://scanme.org/x", "args": "-sV -T4"}, TOOLS)
ok(t.steps[0].use == "core.tool" and t.steps[0].inputs["flag"] is None, "nmap job → core.tool, host-based (no flag)")

t = job_to_task({"tool": "httpx", "target": "https://acme.io", "args": "-title"}, TOOLS)
ok(t.steps[0].inputs["flag"] == "-u", "httpx job → core.tool, url-based (flag -u)")

print("adapter: full flow (custom echo) → v1 result shape")
task = job_to_task({"tool": "custom", "args": "echo drop-in-works"}, TOOLS)
rep = run_task(task, reg)
res = result_from_report(rep)
ok(res["status"] == "done", "result status done")
ok(res["exitCode"] == 0, "exit code 0")
ok("drop-in-works" in res["output"], f"output captured: {res['output']!r}")

print("adapter: host-based argv is built correctly (via core.tool argv output)")
# 'true' exists everywhere; use it as a stand-in 'bin' with a host arg to check argv assembly
TOOLS2 = {"probe": {"bin": "echo", "flag": None}}
task = job_to_task({"tool": "probe", "target": "http://example.com/path", "args": "-a -b"}, TOOLS2)
rep = run_task(task, reg)
argv = rep["run"]["outputs"]["argv"]
ok(argv == ["echo", "-a", "-b", "example.com"], f"scheme/path stripped, args kept: {argv}")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
