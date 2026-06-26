#!/usr/bin/env python3
"""
RD-AISEC runner — the "hands" of the portal.

Runs on a machine YOU control and are authorized to use (e.g. a Kali VM in UTM).
It polls the portal over HTTPS for queued jobs, runs an ALLOWLISTED tool locally,
and posts the output back. The portal turns that output into findings.

  • No inbound ports — it only makes outbound HTTPS requests.
  • Only allowlisted tools run, via argv (never a shell), so there is no shell
    injection surface. Targets/args are re-validated here as defense in depth.
  • Stdlib only — nothing to pip install.

Usage:
    export PORTAL_URL="https://rd-aisec.vercel.app"
    export RUNNER_TOKEN="rdr_...."          # shown once when you create the runner
    python3 rdaisec_runner.py

For authorized security testing and education only.
"""

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

PORTAL_URL = os.environ.get("PORTAL_URL", "").rstrip("/")
RUNNER_TOKEN = os.environ.get("RUNNER_TOKEN", "")
POLL_SECONDS = int(os.environ.get("POLL_SECONDS", "5"))
JOB_TIMEOUT = int(os.environ.get("JOB_TIMEOUT", "900"))  # 15 min per job
MAX_OUTPUT = 200_000  # keep in sync with MAX_OUTPUT_CHARS in the portal

# Allowlist mirrored from lib/runner-constants.ts. Each entry maps a tool id to
# its binary and the flag that carries the target:
#   "flag": None    -> host-based; target appended as the last argv item (scheme stripped)
#   "flag": "-u"    -> URL-based; target passed via that flag (full URL kept)
TOOLS = {
    "nmap":    {"bin": "nmap",    "flag": None},
    "httpx":   {"bin": "httpx",   "flag": "-u"},
    "nuclei":  {"bin": "nuclei",  "flag": "-u"},
    "whois":   {"bin": "whois",   "flag": None},
    "dig":     {"bin": "dig",     "flag": None},
    "sqlmap":  {"bin": "sqlmap",  "flag": "-u"},
    "nikto":   {"bin": "nikto",   "flag": "-h"},
    "wpscan":  {"bin": "wpscan",  "flag": "--url"},
    "sslscan": {"bin": "sslscan", "flag": None},
}

# Whitelists mirrored from the portal — no shell metacharacters in either case.
SAFE_VALUE = re.compile(r"^[A-Za-z0-9 ._:/@,+=\-]+$")          # host targets + flags
SAFE_URL = re.compile(r"^[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+$")  # URL targets


def safe(value: str) -> bool:
    return bool(value) and len(value) <= 512 and bool(SAFE_VALUE.match(value))


def safe_url(value: str) -> bool:
    return (
        bool(value)
        and len(value) <= 1024
        and not value.startswith("-")
        and bool(SAFE_URL.match(value))
    )


def request(method: str, path: str, body=None):
    url = f"{PORTAL_URL}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {RUNNER_TOKEN}")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    return urllib.request.urlopen(req, timeout=30)


def claim_job():
    try:
        resp = request("GET", "/api/runner/job")
        if resp.status == 204:
            return None
        return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        if e.code == 401:
            sys.exit("✗ Runner token rejected. Check RUNNER_TOKEN.")
        print(f"  poll error: HTTP {e.code}")
        return None
    except Exception as e:  # noqa: BLE001
        print(f"  poll error: {e}")
        return None


def build_argv(job):
    spec = TOOLS.get(job["tool"])
    if not spec:
        return None, f"Tool '{job['tool']}' is not allowed on this runner."

    target = job.get("target", "")

    args = [a for a in (job.get("args") or "").split(" ") if a]
    for a in args:
        if not safe(a):
            return None, f"Argument failed validation: {a!r}"

    argv = [spec["bin"], *args]
    if spec["flag"]:
        # URL-based tool (httpx/nuclei/sqlmap/nikto/wpscan) — keep the full URL.
        if not safe_url(target):
            return None, f"Target failed validation: {target!r}"
        argv += [spec["flag"], target]
    else:
        # Host-based tool (nmap/whois/dig/sslscan) — strip any scheme/path.
        host = re.sub(r"^[a-z][a-z0-9+.-]*://", "", target, flags=re.I).split("/")[0]
        if not safe(host):
            return None, f"Target failed validation: {target!r}"
        argv.append(host)
    return argv, None


def run_job(job):
    argv, err = build_argv(job)
    if err:
        return err, 1
    print(f"  $ {' '.join(argv)}")
    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=JOB_TIMEOUT,
            check=False,
        )
        out = (proc.stdout or "") + (proc.stderr or "")
        return out[:MAX_OUTPUT], proc.returncode
    except FileNotFoundError:
        return f"'{argv[0]}' is not installed on this runner.", 127
    except subprocess.TimeoutExpired:
        return f"Job timed out after {JOB_TIMEOUT}s.", 124


def post_result(job_id, output, exit_code):
    status = "done" if exit_code == 0 else "failed"
    try:
        request(
            "POST",
            f"/api/runner/job/{job_id}/result",
            {"output": output, "exitCode": exit_code, "status": status},
        )
    except Exception as e:  # noqa: BLE001
        print(f"  failed to post result: {e}")


def main():
    if not PORTAL_URL or not RUNNER_TOKEN:
        sys.exit("Set PORTAL_URL and RUNNER_TOKEN environment variables first.")
    print(f"RD-AISEC runner → {PORTAL_URL}")
    print(f"Tools available: {', '.join(TOOLS)}")
    print("Polling for jobs… (Ctrl-C to stop)\n")
    while True:
        job = claim_job()
        if job:
            print(f"▶ job {job['id']}: {job['tool']} {job.get('args','')} {job['target']}")
            output, code = run_job(job)
            post_result(job["id"], output, code)
            print(f"  done (exit {code})\n")
        else:
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
