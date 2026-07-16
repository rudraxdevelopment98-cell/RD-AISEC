"""
Channel bus tests — run:  python3 test_channel.py

Verifies the realtime-bus append (post_events) hits the right endpoint with a
batched body, is a no-op on empty input, and is non-fatal when the portal is
unreachable (a job must never fail because the bus is down). No network — the
HTTP call is captured.
"""
import sys
from channel import PollChannel

PASS = FAIL = 0
def ok(c, m):
    global PASS, FAIL
    PASS += c; FAIL += (not c)
    print(("  ✓ " if c else "  ✗ ") + m)

ch = PollChannel("https://portal.example", "rdr_test", lambda: {"X-Runner-Version": "2.0.0"})

# Capture what _request would send instead of hitting the network.
calls = []
def fake_request(method, path, body=None, timeout=30):
    calls.append({"method": method, "path": path, "body": body})
    class R:  # minimal stand-in
        status = 200
    return R()
ch._request = fake_request

print("post_events appends a batch to the job's event endpoint")
ch.post_events("job123", [{"kind": "step", "step": "tls", "status": "done"}])
ok(len(calls) == 1, "one request made")
ok(calls[0]["method"] == "POST", "it's a POST")
ok(calls[0]["path"] == "/api/runner/job/job123/event", "correct bus endpoint")
ok(calls[0]["body"]["events"][0]["step"] == "tls", "events are wrapped under 'events'")

print("empty event list is a no-op (no request)")
calls.clear()
ch.post_events("job123", [])
ok(calls == [], "no request for an empty batch")

print("a bus failure is swallowed — the job is unaffected")
def boom(*a, **k):
    raise ConnectionError("portal down")
ch._request = boom
try:
    ch.post_events("job123", [{"kind": "step", "status": "running"}])
    ok(True, "post_events did not raise when the portal is unreachable")
except Exception:  # noqa: BLE001
    ok(False, "post_events must never raise")

print("post_progress is likewise non-fatal")
try:
    ch.post_progress("job123", "some output")
    ok(True, "post_progress swallows transport errors")
except Exception:  # noqa: BLE001
    ok(False, "post_progress must never raise")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
