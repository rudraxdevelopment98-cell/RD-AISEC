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
import ipaddress
import os
import re
import shlex
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

# Bump when this script changes meaningfully; the portal flags older runners.
RUNNER_VERSION = "14"

# Heartbeat: ping the portal on a background thread so the machine stays "online"
# even while busy running a long job/install (when the main loop isn't polling).
PING_SECONDS = int(os.environ.get("PING_SECONDS", "30"))

# How many jobs to run at once on this machine. Each claimed job runs in its own
# worker thread; raise MAX_WORKERS on a beefier box. 1 = the old serial behavior.
MAX_WORKERS = max(1, int(os.environ.get("MAX_WORKERS", "3")))
ACTIVE_WORKERS = 0
WORKERS_LOCK = threading.Lock()

# Tor anonymity (toggled from the portal). When on, tool traffic is wrapped with
# torsocks so it exits through the Tor network.
TOR_SOCKS = ("127.0.0.1", 9050)
ANON_ON = False
EXIT_IP = ""
_tor_proc = None

# Local subnets this machine is on (detected at startup), reported to the portal
# so you can one-click "scan this runner's network".
SUBNETS: list[str] = []


def detect_subnets() -> list[str]:
    """Return private IPv4 CIDRs for this host's interfaces (e.g. 10.0.0.0/24)."""
    nets: set[str] = set()
    try:
        out = subprocess.run(
            ["ip", "-o", "-f", "inet", "addr", "show"],
            capture_output=True,
            text=True,
            timeout=5,
        ).stdout
    except Exception:  # noqa: BLE001
        return []
    for line in out.splitlines():
        m = re.search(r"\binet\s+(\d+\.\d+\.\d+\.\d+/\d+)", line)
        if not m or m.group(1).startswith("127."):
            continue
        try:
            net = ipaddress.ip_interface(m.group(1)).network
        except ValueError:
            continue
        if net.is_private and 16 <= net.prefixlen <= 30:
            nets.add(str(net))
    return sorted(nets)

def _load_env_files():
    """Load KEY=VALUE config from a file so PORTAL_URL / RUNNER_TOKEN persist
    across terminals and reboots (no need to `export` each time). Real
    environment variables always win, so `export` still overrides the file.

    Checked in order (first found wins per key):
      $RDAISEC_ENV, ./runner.env, ./.env, ~/.config/rdaisec/runner.env
    """
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = []
    if os.environ.get("RDAISEC_ENV"):
        candidates.append(os.environ["RDAISEC_ENV"])
    candidates += [
        os.path.join(here, "runner.env"),
        os.path.join(here, ".env"),
        os.path.expanduser("~/.config/rdaisec/runner.env"),
    ]
    for path in candidates:
        try:
            with open(path, encoding="utf-8") as f:
                for raw in f:
                    line = raw.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, val = line.partition("=")
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    if key and key not in os.environ:  # don't override real env
                        os.environ[key] = val
            print(f"Loaded config from {path}")
        except FileNotFoundError:
            continue
        except Exception:  # noqa: BLE001
            continue


_load_env_files()

PORTAL_URL = os.environ.get("PORTAL_URL", "").rstrip("/")
RUNNER_TOKEN = os.environ.get("RUNNER_TOKEN", "")
POLL_SECONDS = int(os.environ.get("POLL_SECONDS", "5"))
JOB_TIMEOUT = int(os.environ.get("JOB_TIMEOUT", "900"))  # 15 min per job
MAX_OUTPUT = 200_000  # keep in sync with MAX_OUTPUT_CHARS in the portal
# How often to stream partial output of a running job back to the portal (live
# verbose). Set PROGRESS_SECONDS=0 to disable streaming.
PROGRESS_SECONDS = int(os.environ.get("PROGRESS_SECONDS", "3"))

# Default allowlist (fallback). The runner fetches the live allowlist from the
# portal at startup and periodically, so new tools added to the portal work
# WITHOUT re-pulling this script — as long as the binary is installed here.
# Each entry maps a tool id to its binary and the flag that carries the target:
#   "flag": None    -> host-based; target appended as the last argv item (scheme stripped)
#   "flag": "-u"    -> URL-based; target passed via that flag (full URL kept)
DEFAULT_TOOLS = {
    "nmap":    {"bin": "nmap",    "flag": None,    "pkg": "nmap"},
    "httpx":   {"bin": "httpx",   "flag": "-u",    "pkg": None},
    "nuclei":  {"bin": "nuclei",  "flag": "-u",    "pkg": "nuclei"},
    "whois":   {"bin": "whois",   "flag": None,    "pkg": "whois"},
    "dig":     {"bin": "dig",     "flag": None,    "pkg": "dnsutils"},
    "sqlmap":  {"bin": "sqlmap",  "flag": "-u",    "pkg": "sqlmap"},
    "nikto":   {"bin": "nikto",   "flag": "-h",    "pkg": "nikto"},
    "wpscan":  {"bin": "wpscan",  "flag": "--url", "pkg": "wpscan"},
    "sslscan": {"bin": "sslscan", "flag": None,    "pkg": "sslscan"},
}

# Live allowlist — replaced by fetch_tools() at startup if the portal responds.
TOOLS = dict(DEFAULT_TOOLS)

# How often to re-fetch the allowlist from the portal (seconds).
TOOL_REFRESH_SECONDS = int(os.environ.get("TOOL_REFRESH", "300"))

# Tools the portal can install on request (tool id -> apt package). Mirrors
# INSTALLABLE_PKGS in the portal. Only these can be installed — never arbitrary
# package names. httpx/nuclei aren't apt packages, so they're installed manually.
INSTALL_PKGS = {
    "nmap": "nmap",
    "whois": "whois",
    "dig": "dnsutils",
    "sqlmap": "sqlmap",
    "nikto": "nikto",
    "wpscan": "wpscan",
    "sslscan": "sslscan",
    "nuclei": "nuclei",
    "arpscan": "arp-scan",
    "masscan": "masscan",
    "gobuster": "gobuster",
    "whatweb": "whatweb",
    "wafw00f": "wafw00f",
    "dnsrecon": "dnsrecon",
    "dnsenum": "dnsenum",
    "amass": "amass",
    "theharvester": "theharvester",
    "enum4linux": "enum4linux",
    "searchsploit": "exploitdb",
    "metasploit": "metasploit-framework",
}


def installed_tools() -> list[str]:
    """Tool ids in the current allowlist whose binary is present on PATH."""
    return sorted(t for t, spec in TOOLS.items() if shutil.which(spec["bin"]))

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


def request(method: str, path: str, body=None, timeout: int = 30):
    url = f"{PORTAL_URL}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {RUNNER_TOKEN}")
    req.add_header("X-Runner-Version", RUNNER_VERSION)
    req.add_header("X-Runner-Tools", ",".join(sorted(TOOLS)))
    req.add_header("X-Runner-Exit-Ip", EXIT_IP)
    req.add_header("X-Runner-Subnets", ",".join(SUBNETS))
    req.add_header("X-Runner-Installed", ",".join(installed_tools()))
    if data is not None:
        req.add_header("Content-Type", "application/json")
    return urllib.request.urlopen(req, timeout=timeout)


def post_with_retry(path: str, body, what: str) -> bool:
    """POST a result with retries — the DB may be cold (Vercel/Neon) and slow to
    wake, so the first attempt can time out. Returns True on success."""
    for attempt in range(4):
        try:
            request("POST", path, body, timeout=60)
            return True
        except Exception as e:  # noqa: BLE001
            wait = 2 ** attempt
            print(f"  posting {what} failed (try {attempt + 1}/4): {e} — retrying in {wait}s")
            time.sleep(wait)
    print(f"  ✗ could not post {what}. The job will time out on the portal; use Retry there.")
    return False


# ---- Tor anonymity ---------------------------------------------------------

def _port_open(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=3):
            return True
    except OSError:
        return False


def ensure_tor() -> bool:
    """Make sure a Tor SOCKS proxy is reachable on 127.0.0.1:9050."""
    global _tor_proc
    if _port_open(*TOR_SOCKS):
        return True
    if not shutil.which("tor"):
        print("  tor is not installed — run: sudo apt install -y tor torsocks")
        return False
    try:
        _tor_proc = subprocess.Popen(
            ["tor", "--SocksPort", "9050", "--DataDirectory", "/tmp/rdaisec-tor"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as e:  # noqa: BLE001
        print(f"  failed to start tor: {e}")
        return False
    for _ in range(30):
        if _port_open(*TOR_SOCKS):
            return True
        time.sleep(1)
    return False


def tor_exit_ip() -> str:
    if not (shutil.which("torsocks") and shutil.which("curl")):
        return ""
    try:
        r = subprocess.run(
            ["torsocks", "curl", "-s", "--max-time", "20", "https://api.ipify.org"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        ip = (r.stdout or "").strip()
        return ip if re.match(r"^[0-9a-fA-F:.]+$", ip) else ""
    except Exception:  # noqa: BLE001
        return ""


def apply_anonymity(on: bool) -> None:
    """Reconcile local Tor state with the portal's desired setting."""
    global ANON_ON, EXIT_IP
    if on and not ANON_ON:
        print("🧅 Enabling Tor anonymity…")
        if not shutil.which("torsocks"):
            print("  torsocks not installed (sudo apt install -y tor torsocks) — cannot anonymize")
            return
        if ensure_tor():
            ANON_ON = True
            EXIT_IP = tor_exit_ip()
            print(f"  Tor on — exit IP {EXIT_IP or 'unknown'}")
        else:
            print("  could not reach/start Tor; staying non-anonymous")
    elif not on and ANON_ON:
        print("Disabling Tor anonymity.")
        ANON_ON = False
        EXIT_IP = ""


def fetch_tools():
    """Pull the live tool allowlist from the portal. Returns a dict or None."""
    try:
        resp = request("GET", "/api/runner/tools")
        data = json.loads(resp.read().decode())
        tools = {}
        for t in data.get("tools", []):
            tid, b = t.get("id"), t.get("bin")
            if tid and b:
                tools[tid] = {"bin": b, "flag": t.get("flag"), "pkg": t.get("pkg")}
        return tools or None
    except urllib.error.HTTPError as e:
        if e.code == 401:
            sys.exit("✗ Runner token rejected. Check RUNNER_TOKEN.")
        return None  # older portal without the route, etc. — keep current list
    except Exception:  # noqa: BLE001
        return None


def heartbeat_loop():
    """Background: keep the machine 'online' regardless of what the loop is doing."""
    while True:
        try:
            request("GET", "/api/runner/ping")
        except Exception:  # noqa: BLE001
            pass
        time.sleep(PING_SECONDS)


def poll():
    """Poll for the next job. Returns (job_or_None, anonymity_flag_or_None)."""
    try:
        resp = request("GET", "/api/runner/job")
        anon = resp.headers.get("X-Runner-Anonymity") == "on"
        if resp.status == 204:
            return None, anon
        return json.loads(resp.read().decode()), anon
    except urllib.error.HTTPError as e:
        if e.code == 401:
            sys.exit("✗ Runner token rejected. Check RUNNER_TOKEN.")
        print(f"  poll error: HTTP {e.code}")
        try:
            return None, (e.headers.get("X-Runner-Anonymity") == "on")
        except Exception:  # noqa: BLE001
            return None, None
    except Exception as e:  # noqa: BLE001
        print(f"  poll error: {e}")
        return None, None


def build_argv(job):
    # Custom command: the portal sends a full command line in `args`. We parse it
    # with shlex (POSIX argv splitting) and run it WITHOUT a shell — so shell
    # metacharacters (; | & > etc.) become literal arguments, not operators, and
    # there is still no shell-injection surface. This runs only on YOUR machine,
    # queued only by your authenticated portal session.
    if job["tool"] == "custom":
        cmd = (job.get("args") or "").strip()
        if not cmd:
            return None, "Custom command was empty."
        try:
            argv = shlex.split(cmd)
        except ValueError as e:
            return None, f"Could not parse command: {e}"
        if not argv:
            return None, "Custom command was empty."
        return argv, None

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


def post_progress(job_id, output):
    """Best-effort push of partial output for a still-running job (live verbose)."""
    try:
        request("POST", f"/api/runner/job/{job_id}/progress", {"output": output}, timeout=10)
    except Exception:  # noqa: BLE001 — progress is best-effort
        pass


def run_job(job):
    argv, err = build_argv(job)
    if err:
        return err, 1
    # Anonymize TCP-connect traffic through Tor when enabled.
    if ANON_ON and shutil.which("torsocks"):
        argv = ["torsocks", *argv]
    print(f"  $ {' '.join(argv)}")
    job_id = job["id"]

    try:
        proc = subprocess.Popen(
            argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  # merge so the live view shows everything
            text=True,
            bufsize=1,  # line-buffered
        )
    except FileNotFoundError:
        return f"'{argv[0]}' is not installed on this runner.", 127

    # Watchdog kills the process if it runs past the timeout.
    killed = {"v": False}

    def _kill():
        killed["v"] = True
        try:
            proc.kill()
        except Exception:  # noqa: BLE001
            pass

    timer = threading.Timer(JOB_TIMEOUT, _kill)
    timer.start()

    buf: list[str] = []
    size = 0
    truncated = False
    last_post = 0.0
    try:
        for line in proc.stdout:  # type: ignore[union-attr]
            if size < MAX_OUTPUT:
                buf.append(line)
                size += len(line)
            elif not truncated:
                buf.append("\n…(output truncated)…\n")
                truncated = True
            if PROGRESS_SECONDS > 0:
                now = time.monotonic()
                if now - last_post >= PROGRESS_SECONDS:
                    post_progress(job_id, "".join(buf)[:MAX_OUTPUT])
                    last_post = now
        proc.wait()
    finally:
        timer.cancel()

    out = "".join(buf)[:MAX_OUTPUT]
    if killed["v"]:
        return out + f"\n\nJob timed out after {JOB_TIMEOUT}s and was stopped.", 124
    return out, proc.returncode if proc.returncode is not None else 0


def post_result(job_id, output, exit_code):
    status = "done" if exit_code == 0 else "failed"
    post_with_retry(
        f"/api/runner/job/{job_id}/result",
        {"output": output, "exitCode": exit_code, "status": status},
        "job result",
    )


# ---- Tool installs (authorized from the portal) ----------------------------

def poll_install():
    try:
        resp = request("GET", "/api/runner/install")
        if resp.status == 204:
            return None
        return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        if e.code == 401:
            sys.exit("✗ Runner token rejected. Check RUNNER_TOKEN.")
        return None
    except Exception:  # noqa: BLE001
        return None


def run_install(inst):
    # Package name resolution, most authoritative first:
    #   1. pkg sent with the install request (server-driven — always current)
    #   2. pkg from the fetched tool spec
    #   3. the built-in fallback map
    spec = TOOLS.get(inst["tool"], {})
    pkg = inst.get("pkg") or spec.get("pkg") or INSTALL_PKGS.get(inst["tool"])
    if not pkg:
        return f"'{inst['tool']}' isn't installable via apt — install it manually.", 1
    if not shutil.which("apt-get"):
        return "apt-get not found — this runner isn't a Debian/Kali system.", 127

    # Privilege escalation, in order of preference:
    #   - running as root                  -> no sudo
    #   - RUNNER_SUDO_PASS set (LOCAL env) -> sudo -S (password piped from here)
    #   - otherwise                        -> sudo -n (fails if a password is needed)
    # The password lives ONLY in this machine's env — it is never sent to the portal.
    pw = os.environ.get("RUNNER_SUDO_PASS")
    if os.geteuid() == 0:
        sudo, stdin_in = [], None
    elif pw:
        sudo, stdin_in = ["sudo", "-S", "-p", ""], pw + "\n"
    else:
        sudo, stdin_in = ["sudo", "-n"], None

    env = {**os.environ, "DEBIAN_FRONTEND": "noninteractive"}
    parts: list[str] = []
    code = 0
    try:
        up = subprocess.run(
            sudo + ["apt-get", "update"],
            input=stdin_in, capture_output=True, text=True, timeout=300, env=env,
        )
        parts.append(up.stdout + up.stderr)
        ins = subprocess.run(
            sudo + ["apt-get", "install", "-y", pkg],
            input=stdin_in, capture_output=True, text=True, timeout=600, env=env,
        )
        parts.append(ins.stdout + ins.stderr)
        code = ins.returncode
    except subprocess.TimeoutExpired:
        return "Install timed out.", 124

    text = "\n".join(parts)
    low = text.lower()
    if code != 0 and ("password is required" in low or "sudo:" in low or "incorrect password" in low):
        text += (
            "\n\nThe runner needs root to install. Either run it as root, set "
            "RUNNER_SUDO_PASS on the runner, or give the user passwordless sudo for apt."
        )
    return text[:MAX_OUTPUT], code


def post_install_result(inst_id, output, code):
    post_with_retry(
        f"/api/runner/install/{inst_id}/result",
        {"output": output, "exitCode": code},
        "install result",
    )


def worker(job):
    """Run one job in its own thread and post the result; free the slot after."""
    global ACTIVE_WORKERS
    try:
        print(f"▶ job {job['id']}: {job['tool']} {job.get('args','')} {job['target']}")
        output, code = run_job(job)
        post_result(job["id"], output, code)
        print(f"  done {job['id']} (exit {code})\n")
    except Exception as e:  # noqa: BLE001 — never let a worker crash silently
        try:
            post_result(job["id"], f"runner error: {e}", 1)
        except Exception:  # noqa: BLE001
            pass
    finally:
        with WORKERS_LOCK:
            ACTIVE_WORKERS -= 1


def main():
    global TOOLS, SUBNETS, ACTIVE_WORKERS
    if not PORTAL_URL or not RUNNER_TOKEN:
        sys.exit("Set PORTAL_URL and RUNNER_TOKEN environment variables first.")
    print(f"RD-AISEC runner → {PORTAL_URL}")

    SUBNETS = detect_subnets()
    if SUBNETS:
        print(f"Local network(s): {', '.join(SUBNETS)}")

    fetched = fetch_tools()
    if fetched:
        TOOLS = fetched
        print(f"Tools available (from portal): {', '.join(sorted(TOOLS))}")
    else:
        print(f"Tools available (built-in defaults): {', '.join(sorted(TOOLS))}")
    print("Polling for jobs… (Ctrl-C to stop)\n")

    print("Anonymity (Tor) is controlled from the portal → Machines.\n")

    # Start the heartbeat so we stay online during long jobs/installs.
    threading.Thread(target=heartbeat_loop, daemon=True).start()

    print(f"Concurrency: up to {MAX_WORKERS} job(s) at once.\n")

    last_refresh = time.monotonic()
    while True:
        # Refresh the allowlist periodically so new portal tools appear here.
        if time.monotonic() - last_refresh > TOOL_REFRESH_SECONDS:
            f = fetch_tools()
            if f:
                TOOLS = f
            last_refresh = time.monotonic()

        # Claim and dispatch jobs until we hit the worker cap or the queue empties.
        started = 0
        while True:
            with WORKERS_LOCK:
                if ACTIVE_WORKERS >= MAX_WORKERS:
                    break
            job, anon = poll()
            if anon is not None:
                apply_anonymity(anon)
            if not job:
                break
            # Unknown tool? Refresh once immediately before running it.
            if job["tool"] not in TOOLS:
                f = fetch_tools()
                if f:
                    TOOLS = f
                    last_refresh = time.monotonic()
            with WORKERS_LOCK:
                ACTIVE_WORKERS += 1
            threading.Thread(target=worker, args=(job,), daemon=True).start()
            started += 1

        if started:
            # Loop back quickly to claim more (a worker may free a slot soon).
            time.sleep(1)
            continue

        # Idle this pass. Only handle installs when nothing is running.
        with WORKERS_LOCK:
            busy = ACTIVE_WORKERS
        if busy == 0:
            inst = poll_install()
            if inst:
                print(f"⬇ install {inst['tool']}…")
                out, code = run_install(inst)
                post_install_result(inst["id"], out, code)
                print(f"  install {'ok' if code == 0 else 'failed'} (exit {code})\n")
                continue

        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        if _tor_proc is not None:
            _tor_proc.terminate()
