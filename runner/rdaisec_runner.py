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

import base64
import fcntl
import hashlib
import json
import ipaddress
import os
import pty
import re
import select
import shlex
import shutil
import socket
import struct
import subprocess
import sys
import termios
import threading
import time
import urllib.error
import urllib.request
import collections
import http.server

# Bump when this script changes meaningfully; the portal flags older runners.
#
# v53 — reliability rebuild. The runner kept going "offline" and getting stuck;
# the root causes were architectural, so they're fixed at the source here:
#   1. Telemetry (CPU/GPU/temp/power/installed-tools) is sampled on a background
#      thread into a cached snapshot. request() reads the snapshot instantly and
#      never blocks gathering stats — a slow nvidia-smi / disk read can no longer
#      stall the heartbeat and flip the box "offline". The heartbeat is now a
#      pure, lightweight pinger.
#   2. Network self-heal is now STRICTLY NON-DESTRUCTIVE. It never touches the
#      uplink (the default-route interface), never restarts NetworkManager, never
#      bounces interfaces or renews DHCP. The one safe thing it does is drop a
#      *non-uplink* adapter out of monitor mode (undoing a WiFi capture that
#      knocked the box off) — so recovery can never deepen an outage. A brief NAT
#      blip in a VM no longer triggers a network-restart storm.
#   3. Every subsystem stays fully isolated: nothing a background loop does can
#      take the runner offline or kill the core poll→run→post loop.
#
# v58 — self-healing enrollment. A machine can carry a reusable RUNNER_ENROLL_CODE
# (portal → Runners) instead of a hand-pasted token: with no token, or when its
# token is rotated/wiped (HTTP 401), it fetches a fresh one from /api/runner/enroll
# and saves it — so token loss no longer means SSHing in to edit systemd. A stable
# machine fingerprint lets a re-enroll reclaim the same runner row in place.
#
# v59 — live command stream (push). The runner holds one Server-Sent-Events
# connection to /api/runner/stream: the portal pushes "wake" (queued work → claim
# now, no 5s wait), "cancel", and "restart", and the open connection itself marks
# the machine online (presence). Pure accelerator layered on the existing poll +
# heartbeat — if the stream can't connect, everything works exactly as before.
#
# v60 — full interactive control over the SAME stream. The portal (behind an
# owner-granted, time-boxed unlock) can open a real PTY terminal, transfer files,
# list processes, control services, and install any package — delivered as
# "control" frames on the stream and streamed back via /api/runner/control/msg.
RUNNER_VERSION = "63"

# Heartbeat: ping the portal on a background thread so the machine stays "online"
# even while busy running a long job/install (when the main loop isn't polling).
PING_SECONDS = int(os.environ.get("PING_SECONDS", "15"))

# Daily self-heal / maintenance cycle. Once a day, inside a quiet window (default
# 06:00–08:00 local), the machine refreshes the package index, frees disk,
# refreshes tool databases and self-tests — reporting the stage it's on to the
# portal (X-Runner-Maint header) so the UI shows a live pipeline. All steps are
# best-effort and never crash the runner.
#
# SAFETY: a full unattended `apt-get upgrade` is DISABLED by default — it can
# restart networking/systemd services and knock the machine offline mid-pass.
# The safe steps (index refresh, cache clean, tool-DB refresh, self-test) always
# run. Set MAINT_APT_UPGRADE=1 only if you accept the risk of unattended system
# upgrades on this machine.
MAINT_ENABLED = os.environ.get("MAINT_ENABLED", "1") not in ("0", "false", "no")
MAINT_APT_UPGRADE = os.environ.get("MAINT_APT_UPGRADE", "0") in ("1", "true", "yes")
MAINT_START_HOUR = int(os.environ.get("MAINT_START_HOUR", "6"))
MAINT_END_HOUR = int(os.environ.get("MAINT_END_HOUR", "8"))
MAINT = "idle"  # current stage encoded as "stage|pct|note" for the header

# Housekeeping: clear the runner's own stale temp files + tool caches on a short
# cycle (between the daily maintenance passes) so a busy box doesn't fill its disk.
CLEANUP_SECONDS = int(os.environ.get("CLEANUP_SECONDS", str(3 * 3600)))  # every 3h
TEMP_MAX_AGE = int(os.environ.get("TEMP_MAX_AGE", "3600"))  # only remove temp >1h old

# Connection guardian: a dedicated, always-on algorithm that keeps the runner
# reachable in the hardest situations (WiFi/monitor mode knocking it off, DHCP
# lease loss, NetworkManager killed, driver wedge). It probes connectivity and
# escalates local-network recovery until the box is back online.
GUARDIAN_SECONDS = int(os.environ.get("GUARDIAN_SECONDS", "20"))
# Absolute last resort: reboot after this many seconds of continuous TOTAL outage
# (local network down, not just the portal). OFF by default — opt in, since a
# reboot re-queues in-flight jobs.
GUARDIAN_REBOOT = os.environ.get("GUARDIAN_REBOOT", "0") in ("1", "true", "yes")
GUARDIAN_REBOOT_AFTER = int(os.environ.get("GUARDIAN_REBOOT_AFTER", str(45 * 60)))
MAINT_LOCK = threading.Lock()

# How many jobs to run at once on this machine. Each claimed job runs in its own
# worker thread; 1 = serial. This env var is just the STARTING value — the portal
# (Machines page) controls it live via the X-Runner-Max-Workers poll header.
MAX_WORKERS = max(1, int(os.environ.get("MAX_WORKERS", "3")))
ACTIVE_WORKERS = 0
WORKERS_LOCK = threading.Lock()

# ── Local status dashboard (on the machine itself) ───────────────────────────
# A small read-only web page served on 127.0.0.1 so you can SEE the runner's
# health right on the box — connected/offline, current jobs, recent events, and
# any error — without opening the portal. Bound to loopback only (never exposed).
STATUS_PORT = int(os.environ.get("RDAISEC_STATUS_PORT", "8787"))
STATUS_ENABLED = os.environ.get("RDAISEC_STATUS", "1") not in ("0", "false", "no")
DESKTOP_NOTIFY = os.environ.get("RDAISEC_NOTIFY", "1") not in ("0", "false", "no")
_STARTED_AT = time.time()
_STATUS = {"connected": False, "last_ok": 0.0, "last_error": ""}
_LOG_RING: "collections.deque" = collections.deque(maxlen=250)
_STATUS_LOCK = threading.Lock()
# job_id -> {"tool","target","at"} for whatever is running right now.
RUNNING_JOBS: dict = {}


def note(msg: str, err: bool = False) -> None:
    """Print a line AND keep it in a ring buffer the local status page shows.
    `err=True` also records it as the current error."""
    line = f"{time.strftime('%H:%M:%S')}  {msg}"
    with _STATUS_LOCK:
        _LOG_RING.append(line)
        if err:
            _STATUS["last_error"] = msg
    try:
        print(("✗ " if err else "") + msg, flush=True)
    except Exception:  # noqa: BLE001
        pass


def _notify(title: str, body: str) -> None:
    """Best-effort desktop notification (notify-send), so a disconnect is visible
    on the machine even if nobody's watching the terminal. Never raises."""
    if not DESKTOP_NOTIFY or not shutil.which("notify-send"):
        return
    try:
        subprocess.run(["notify-send", "-a", "RD-AISEC runner", title, body],
                       capture_output=True, timeout=5)
    except Exception:  # noqa: BLE001
        pass

# Set by the live command stream when the portal pushes a "wake" (there's queued
# work). The main loop waits on this instead of a fixed sleep, so a job runs the
# instant it's queued rather than up to POLL_SECONDS later. If the stream never
# connects, the loop just falls back to its POLL_SECONDS tick — pure accelerator.
WAKE = threading.Event()

# True until our first successful job poll. While set, requests carry
# X-Runner-Boot so the portal requeues any jobs left "running" under us by a
# previous process (self-update / crash) — they'd otherwise never retry.
BOOT = True

# Tor anonymity (toggled from the portal). When on, tool traffic is wrapped with
# torsocks so it exits through the Tor network.
TOR_SOCKS = ("127.0.0.1", 9050)
ANON_ON = False
EXIT_IP = ""
# Reported to the portal so it shows a real state instead of a stuck "connecting":
#   off | connecting | on | no-tor (tor/torsocks not installed)
ANON_STATUS = "off"
_tor_proc = None

# Local subnets this machine is on (detected at startup), reported to the portal
# so you can one-click "scan this runner's network".
SUBNETS: list[str] = []

# Wireless interfaces + whether any adapter supports monitor mode (for WiFi).
WIFI_IFACES: list[str] = []
WIFI_MONITOR = False
# Per-adapter chipset/driver detail, e.g. ["wlan0:ath9k_htc"], so the portal can
# offer device-aware AirSight options (monitor/injection/CSI per adapter).
WIFI_DETAIL: list[str] = []


def _iface_driver(iface: str) -> str:
    """Best-effort chipset/driver name for a wireless interface (kernel driver +
    a USB product hint when available). Read-only, no network."""
    driver = ""
    try:
        # /sys/class/net/<iface>/device/driver → symlink whose basename = driver.
        link = os.path.realpath(f"/sys/class/net/{iface}/device/driver")
        if link and link != "/":
            driver = os.path.basename(link)
    except Exception:  # noqa: BLE001
        pass
    if not driver and shutil.which("ethtool"):
        try:
            out = subprocess.run(["ethtool", "-i", iface], capture_output=True, text=True, timeout=5).stdout
            m = re.search(r"driver:\s*(\S+)", out)
            if m:
                driver = m.group(1)
        except Exception:  # noqa: BLE001
            pass
    return driver or "unknown"


def _wireless_ifaces_sysfs() -> list[str]:
    """Wireless interfaces straight from the kernel — needs NO tools. Any net
    device with a phy80211/wireless node under /sys is a Wi-Fi adapter. This is the
    reliable path when `iw`/`iwconfig` aren't installed (the old code reported no
    Wi-Fi at all in that case, even with an adapter plugged in)."""
    found: list[str] = []
    try:
        for name in sorted(os.listdir("/sys/class/net")):
            base = os.path.join("/sys/class/net", name)
            if os.path.exists(os.path.join(base, "phy80211")) or os.path.exists(os.path.join(base, "wireless")):
                found.append(name)
    except Exception:  # noqa: BLE001
        pass
    return found


def detect_wifi() -> tuple[list[str], bool]:
    """Return (wireless interface names, any-adapter-supports-monitor-mode).
    Also refreshes WIFI_DETAIL with per-iface driver names. Detection is layered so
    a connected adapter is found even without `iw` installed:
      1. kernel sysfs (phy80211) — driver-level, no tools needed
      2. `iw dev`      — merges in monitor vifs / confirms
      3. `iwconfig`    — legacy fallback
    Monitor-mode capability needs `iw list`; if `iw` is absent we still LIST the
    adapter (so it shows up) but can't confirm monitor support."""
    global WIFI_DETAIL
    ifaces: list[str] = list(_wireless_ifaces_sysfs())
    monitor = False

    if shutil.which("iw"):
        try:
            out = subprocess.run(["iw", "dev"], capture_output=True, text=True, timeout=5).stdout
            for line in out.splitlines():
                m = re.search(r"Interface\s+(\S+)", line)
                if m and m.group(1) not in ifaces:
                    ifaces.append(m.group(1))
        except Exception:  # noqa: BLE001
            pass
        try:
            lst = subprocess.run(["iw", "list"], capture_output=True, text=True, timeout=8).stdout
            # "* monitor" appears under "Supported interface modes" when capable.
            if re.search(r"\*\s*monitor", lst):
                monitor = True
        except Exception:  # noqa: BLE001
            pass
    elif shutil.which("iwconfig"):
        try:
            out = subprocess.run(["iwconfig"], capture_output=True, text=True, timeout=5).stdout
            for line in out.splitlines():
                m = re.match(r"^(\S+)\s+IEEE 802\.11", line)
                if m and m.group(1) not in ifaces:
                    ifaces.append(m.group(1))
        except Exception:  # noqa: BLE001
            pass

    WIFI_DETAIL = [f"{i}:{_iface_driver(i)}" for i in ifaces]
    return ifaces, monitor


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

    Precedence (first found wins per key):
      1. $RDAISEC_ENV (explicit override)
      2. ~/.config/rdaisec/runner.env  ← the CANONICAL config: where the desktop
         app writes settings AND where the runner persists its enrolled token.
         It MUST outrank the files below so a fresh enroll code / token from the
         app is never shadowed by a stale file left next to the script (e.g. an
         old `curl|bash` install's ~/.rdaisec/runner.env). This shadowing was the
         cause of "enrollment failed: unknown or revoked code" after re-pasting a
         valid code.
      3. runner.env / .env sitting next to the script (portable installs)
    """
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = []
    if os.environ.get("RDAISEC_ENV"):
        candidates.append(os.environ["RDAISEC_ENV"])
    candidates += [
        os.path.expanduser("~/.config/rdaisec/runner.env"),
        os.path.join(here, "runner.env"),
        os.path.join(here, ".env"),
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
# Optional self-enrollment: with a reusable code (portal → Runners) a machine that
# has no token — or whose token was rotated/wiped — fetches a fresh one itself,
# instead of a human editing systemd. See enroll().
ENROLL_CODE = os.environ.get("RUNNER_ENROLL_CODE", "").strip()
# Where an enrolled token is persisted so restarts don't re-enroll (this path is
# also one of the config files _load_env_files reads at startup).
TOKEN_STORE = os.path.expanduser("~/.config/rdaisec/runner.env")
POLL_SECONDS = int(os.environ.get("POLL_SECONDS", "5"))
# Read timeout for the live command stream. The endpoint keeps a connection ~25s
# and pings every ~2.5s, so a stall longer than this means the link is dead →
# reconnect. Longer than the stream's own lifetime so a healthy stream never trips it.
STREAM_TIMEOUT = int(os.environ.get("STREAM_TIMEOUT", "40"))
JOB_TIMEOUT = int(os.environ.get("JOB_TIMEOUT", "900"))  # default per job
# Per-tool timeout overrides (seconds). Thorough scanners (nmap -p-, full nuclei,
# nikto, sqlmap) routinely need more than 15 min — without this they get killed
# mid-scan and report nothing. Each tool is ALSO bounded by its own args
# (--host-timeout / -maxtime / rate limits) so it returns partial results in time.
TOOL_TIMEOUTS = {
    "nmap": 2400,
    "nuclei": 1800,
    "nikto": 1500,
    "gobuster": 1200,
    "wpscan": 1200,
    "sqlmap": 1800,
    "amass": 1200,
    "dnsenum": 900,
    "masscan": 900,
    "enum4linux": 900,
    "subfinder": 900,
    "naabu": 900,
    "katana": 1200,
    "dalfox": 1500,
    "ffuf": 1200,
    "gau": 600,
}


def job_timeout(tool: str) -> int:
    return TOOL_TIMEOUTS.get(tool, JOB_TIMEOUT)


MAX_OUTPUT = 200_000  # keep in sync with MAX_OUTPUT_CHARS in the portal
# How often to stream partial output of a running job back to the portal (live
# verbose). Set PROGRESS_SECONDS=0 to disable streaming.
PROGRESS_SECONDS = int(os.environ.get("PROGRESS_SECONDS", "3"))
# apt install can be huge (metasploit-framework is ~2 GB) — give it plenty of time.
INSTALL_TIMEOUT = int(os.environ.get("INSTALL_TIMEOUT", "1800"))  # 30 min

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
    "subfinder": {"bin": "subfinder", "flag": "-d",    "pkg": "subfinder"},
    "naabu":     {"bin": "naabu",     "flag": "-host", "pkg": "naabu"},
    "katana":    {"bin": "katana",    "flag": "-u",    "pkg": "katana"},
    "dalfox":    {"bin": "dalfox",    "flag": "url",   "pkg": "dalfox"},
    "ffuf":      {"bin": "ffuf",      "flag": "-u",    "pkg": "ffuf"},
    "gau":       {"bin": "gau",       "flag": None,    "pkg": None},
    "feroxbuster": {"bin": "feroxbuster", "flag": "-u",        "pkg": "feroxbuster"},
    "dirsearch":   {"bin": "dirsearch",   "flag": "-u",        "pkg": "dirsearch"},
    "testssl":     {"bin": "testssl.sh",  "flag": None,        "pkg": "testssl.sh"},
    "sslyze":      {"bin": "sslyze",      "flag": None,        "pkg": "sslyze"},
    "nbtscan":     {"bin": "nbtscan",     "flag": None,        "pkg": "nbtscan"},
    "smbmap":      {"bin": "smbmap",      "flag": "-H",        "pkg": "smbmap"},
    "fierce":      {"bin": "fierce",      "flag": "--domain",  "pkg": "fierce"},
    "sublist3r":   {"bin": "sublist3r",   "flag": "-d",        "pkg": "sublist3r"},
    "commix":      {"bin": "commix",      "flag": "--url",     "pkg": "commix"},
    "gospider":    {"bin": "gospider",    "flag": "-s",        "pkg": None},
    "waybackurls": {"bin": "waybackurls", "flag": None,        "pkg": None},
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
    "subfinder": "subfinder",
    "naabu": "naabu",
    "katana": "katana",
    "dalfox": "dalfox",
    "ffuf": "ffuf",
    "metasploit": "metasploit-framework",
    "hashcat": "hashcat",
    "hcxtools": "hcxtools",
    "hcxdumptool": "hcxdumptool",
    "wifiphisher": "wifiphisher",
    "tor": "tor",
    "torsocks": "torsocks",
    "aircrack": "aircrack-ng",
    "feroxbuster": "feroxbuster",
    "dirsearch": "dirsearch",
    "testssl": "testssl.sh",
    "sslyze": "sslyze",
    "nbtscan": "nbtscan",
    "smbmap": "smbmap",
    "fierce": "fierce",
    "sublist3r": "sublist3r",
    "commix": "commix",
}


# `go install` sources, used as the PRIMARY method for tools with no apt package
# (httpx) and as a FALLBACK for the other ProjectDiscovery tools when apt fails
# or apt-get is unavailable. The source is fixed here (an allowlist), so the
# portal can only name a tool id — it can never make the runner `go install` an
# arbitrary module. Mirrors GO_SOURCES in the portal.
GO_INSTALL = {
    "httpx": "github.com/projectdiscovery/httpx/cmd/httpx@latest",
    "subfinder": "github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest",
    "naabu": "github.com/projectdiscovery/naabu/v2/cmd/naabu@latest",
    "katana": "github.com/projectdiscovery/katana/cmd/katana@latest",
    "dalfox": "github.com/hahwul/dalfox/v2@latest",
    "nuclei": "github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest",
    "ffuf": "github.com/ffuf/ffuf/v2@latest",
    "gau": "github.com/lc/gau/v2/cmd/gau@latest",
    "gospider": "github.com/jaeles-project/gospider@latest",
    "waybackurls": "github.com/tomnomnom/waybackurls@latest",
}


# Installable packages that aren't queueable tools — map their install id to the
# binary so we can still report them as installed (else they'd show "missing"
# forever after a successful install).
EXTRA_INSTALL_BINS = {
    "metasploit": "msfconsole",
    "tor": "tor",
    "torsocks": "torsocks",
    "aircrack": "aircrack-ng",
    "hashcat": "hashcat",
    "hcxtools": "hcxpcapngtool",
    "hcxdumptool": "hcxdumptool",
    "wifiphisher": "wifiphisher",
}


# ── Lightweight TTL cache ────────────────────────────────────────────────────
# Every request() to the portal (heartbeat ping, job poll, result post) attaches
# machine stats. Some are expensive — nvidia-smi, `iw`, probing ~50 tool binaries
# — and under heavy job load those subprocesses can stall the heartbeat long
# enough to miss the online window, so the machine flaps "offline". Cache the
# costly ones for a few seconds so frequent requests stay cheap and the heartbeat
# never blocks on them.
_TTL_CACHE: dict = {}


def _cached(key: str, ttl: float, producer):
    """Return producer()'s value, recomputing at most once per `ttl` seconds.
    Never raises — a producer error falls back to the last value (or None)."""
    now = time.monotonic()
    hit = _TTL_CACHE.get(key)
    if hit is not None and now - hit[0] < ttl:
        return hit[1]
    try:
        val = producer()
    except Exception:  # noqa: BLE001
        return hit[1] if hit is not None else None
    _TTL_CACHE[key] = (now, val)
    return val


def _installed_tools_uncached() -> list[str]:
    present = [t for t, spec in TOOLS.items() if shutil.which(spec["bin"])]
    present += [tid for tid, b in EXTRA_INSTALL_BINS.items() if shutil.which(b)]
    return sorted(set(present))


def installed_tools() -> list[str]:
    """Install ids whose binary is present on PATH (allowlisted tools + extras).
    Cached ~60s — it's probed on every request and rarely changes between them."""
    return _cached("installed_tools", 60.0, _installed_tools_uncached) or []

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


def safe_header_token(value: str) -> bool:
    """A pre-computed auth-injection token from the portal (e.g. `-H` or a
    `Cookie: session=…` value). The portal already validated + built these; we
    re-check that each is a single line of printable ASCII within a sane length.
    They run via argv (no shell), so a header value with spaces is just one
    argument — no injection surface."""
    return (
        isinstance(value, str)
        and 0 < len(value) <= 1024
        and all(0x20 <= ord(c) <= 0x7E for c in value)
    )


# Flags whose following value carries a secret (auth session / cookie); redact
# that value when echoing the command so a token never lands in the console log.
_SECRET_FLAGS = {"-H", "--header", "--cookie", "--cookie-string", "-b"}


def redact_argv(argv):
    """Return a copy of argv with secret-bearing values masked for display."""
    out = []
    redact_next = False
    for tok in argv:
        if redact_next:
            out.append("<redacted>")
            redact_next = False
            continue
        out.append(tok)
        if tok in _SECRET_FLAGS:
            redact_next = True
    return out


# ── Live machine stats (Linux /proc + /sys, stdlib only) ─────────────────────
# Reported on every request so the portal's footer monitor shows CPU / RAM /
# temperature. All best-effort: absent files (non-Linux, VMs w/o thermal) just
# omit that stat.
_cpu_prev = None  # (idle, total) from the previous /proc/stat sample


def _cpu_pct():
    global _cpu_prev
    try:
        with open("/proc/stat") as f:
            parts = [int(x) for x in f.readline().split()[1:]]
        idle = parts[3] + (parts[4] if len(parts) > 4 else 0)  # idle + iowait
        total = sum(parts)
        prev = _cpu_prev
        _cpu_prev = (idle, total)
        if prev is None:
            return None  # need two samples to compute a delta
        d_total = total - prev[1]
        if d_total <= 0:
            return None
        return max(0, min(100, round((1 - (idle - prev[0]) / d_total) * 100)))
    except Exception:  # noqa: BLE001
        return None


def _mem_pct():
    try:
        info = {}
        with open("/proc/meminfo") as f:
            for line in f:
                k, _, v = line.partition(":")
                info[k] = int(v.strip().split()[0])
        total = info.get("MemTotal", 0)
        avail = info.get("MemAvailable", info.get("MemFree", 0))
        if total <= 0:
            return None
        return max(0, min(100, round((1 - avail / total) * 100)))
    except Exception:  # noqa: BLE001
        return None


def _temp_c():
    best = None
    try:
        import glob

        for p in glob.glob("/sys/class/thermal/thermal_zone*/temp"):
            try:
                with open(p) as f:
                    raw = int(f.read().strip())
                c = raw / 1000 if raw > 1000 else raw
                if best is None or c > best:
                    best = c
            except Exception:  # noqa: BLE001
                continue
    except Exception:  # noqa: BLE001
        pass
    return round(best) if best is not None else None


def _loadavg():
    try:
        with open("/proc/loadavg") as f:
            return " ".join(f.read().split()[:3])
    except Exception:  # noqa: BLE001
        return ""


def _mem_mb():
    """(used_MB, total_MB) of RAM, or (None, None)."""
    try:
        info = {}
        with open("/proc/meminfo") as f:
            for line in f:
                k, _, v = line.partition(":")
                info[k] = int(v.strip().split()[0])  # kB
        total = info.get("MemTotal", 0) // 1024
        avail = info.get("MemAvailable", info.get("MemFree", 0)) // 1024
        if total <= 0:
            return (None, None)
        return (max(0, total - avail), total)
    except Exception:  # noqa: BLE001
        return (None, None)


def _disk_mb():
    """(used_MB, total_MB) of the root filesystem, or (None, None)."""
    try:
        st = os.statvfs("/")
        total = st.f_blocks * st.f_frsize
        free = st.f_bavail * st.f_frsize
        return (round(max(0, total - free) / 1048576), round(total / 1048576))
    except Exception:  # noqa: BLE001
        return (None, None)


def _uptime_s():
    try:
        with open("/proc/uptime") as f:
            return int(float(f.read().split()[0]))
    except Exception:  # noqa: BLE001
        return None


def _gpu_pct():
    """GPU utilisation %, cached ~15s (nvidia-smi is a subprocess we don't want to
    spawn on every request under load)."""
    return _cached("gpu_pct", 15.0, _gpu_pct_uncached)


def _gpu_pct_uncached():
    """GPU utilisation %, best-effort (NVIDIA smi, then AMD/Intel sysfs)."""
    try:
        if shutil.which("nvidia-smi"):
            out = subprocess.run(
                ["nvidia-smi", "--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=4,
            ).stdout.strip().splitlines()
            if out:
                return max(0, min(100, int(float(out[0].strip()))))
    except Exception:  # noqa: BLE001
        pass
    try:
        import glob
        for p in glob.glob("/sys/class/drm/card*/device/gpu_busy_percent"):
            with open(p) as f:
                return max(0, min(100, int(f.read().strip())))
    except Exception:  # noqa: BLE001
        pass
    return None


def _power():
    """(battery_pct, charging 0/1, watts) from /sys/class/power_supply. Best-effort."""
    try:
        import glob
        cap = charging = watts = None
        for d in sorted(glob.glob("/sys/class/power_supply/BAT*")):
            try:
                with open(d + "/capacity") as f:
                    cap = int(f.read().strip())
            except Exception:  # noqa: BLE001
                pass
            try:
                with open(d + "/status") as f:
                    charging = 1 if f.read().strip().lower() in ("charging", "full") else 0
            except Exception:  # noqa: BLE001
                pass
            try:
                with open(d + "/power_now") as f:
                    watts = round(int(f.read().strip()) / 1_000_000)  # µW → W
            except Exception:  # noqa: BLE001
                try:
                    with open(d + "/current_now") as f:
                        cur = int(f.read().strip())
                    with open(d + "/voltage_now") as f:
                        volt = int(f.read().strip())
                    watts = round(cur * volt / 1e12)
                except Exception:  # noqa: BLE001
                    pass
            break
        return cap, charging, watts
    except Exception:  # noqa: BLE001
        return None, None, None


# ── Telemetry cache (off the request hot path) ──────────────────────────────
# Gathering stats can touch subprocesses (nvidia-smi) and many filesystem reads.
# Doing that inline in request() meant a single slow read stalled the heartbeat
# and flipped the box "offline" under load — the #1 chronic failure. So a
# background thread samples everything a few times a minute into a snapshot, and
# request() just reads the snapshot (a dict copy — instant, never blocks). WiFi
# re-detection lives here too, so the heartbeat is a pure pinger.
STATS_SECONDS = int(os.environ.get("STATS_SECONDS", "8"))
_STATS: dict = {}
_STATS_LOCK = threading.Lock()


def _sample_stats() -> None:
    """Compute the full telemetry snapshot. Runs on the stats thread; never on the
    request path. Best-effort — any collector returning None is simply omitted."""
    global WIFI_IFACES, WIFI_MONITOR
    mem_u, mem_t = _mem_mb()
    disk_u, disk_t = _disk_mb()
    bat, chg, watts = _power()
    snap = {
        "cpu": _cpu_pct(), "mem": _mem_pct(), "temp": _temp_c(), "load": _loadavg(),
        "mem_used": mem_u, "mem_total": mem_t, "disk_used": disk_u, "disk_total": disk_t,
        "cores": os.cpu_count(), "uptime": _uptime_s(), "gpu": _gpu_pct_uncached(),
        "battery": bat, "charging": chg, "power": watts,
        "installed": installed_tools(),
    }
    with _STATS_LOCK:
        _STATS.clear()
        _STATS.update(snap)
    # Re-detect WiFi here (a subprocess) so plugging in a monitor dongle is noticed
    # without ever stalling the heartbeat.
    try:
        WIFI_IFACES, WIFI_MONITOR = detect_wifi()
    except Exception:  # noqa: BLE001
        pass


def stats_loop() -> None:
    """Background: keep the telemetry snapshot fresh. Never raises."""
    while True:
        try:
            _sample_stats()
        except Exception:  # noqa: BLE001
            pass
        time.sleep(STATS_SECONDS)


# HTTP header values must be latin-1 encodable (http.client encodes them as
# latin-1). Telemetry we put in X-Runner-* headers comes from the OS — GPU model
# names, Wi-Fi SSIDs, load strings — which routinely contain Unicode punctuation
# (en/em dashes, smart quotes) or emoji. One such character used to raise
# UnicodeEncodeError deep in urlopen, abort the whole request, and flip the
# machine OFFLINE. So every header value is normalized here: common typographic
# punctuation is folded to ASCII, then anything still outside latin-1 is dropped.
# This can never raise, so a stray character can never take the runner down.
_HEADER_FOLD = {
    "–": "-", "—": "-", "‒": "-", "―": "-", "−": "-",
    "‘": "'", "’": "'", "‚": "'", "‛": "'",
    "“": '"', "”": '"', "„": '"',
    "…": "...", " ": " ", " ": " ", "​": "",
}


def _safe_header(value) -> str:
    s = str(value)
    for bad, good in _HEADER_FOLD.items():
        if bad in s:
            s = s.replace(bad, good)
    # Final guard: drop anything still outside the latin-1 header charset.
    return s.encode("latin-1", "ignore").decode("latin-1")


def request(method: str, path: str, body=None, timeout: int = 30):
    url = f"{PORTAL_URL}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)

    def hdr(name, value):
        req.add_header(name, _safe_header(value))

    hdr("Authorization", f"Bearer {RUNNER_TOKEN}")
    hdr("X-Runner-Version", RUNNER_VERSION)
    hdr("X-Runner-Tools", ",".join(sorted(TOOLS)))
    hdr("X-Runner-Exit-Ip", EXIT_IP)
    hdr("X-Runner-Anon-Status", ANON_STATUS)
    hdr("X-Runner-Subnets", ",".join(SUBNETS))
    hdr("X-Runner-Wifi", ",".join(WIFI_IFACES))
    hdr("X-Runner-Wifi-Monitor", "1" if WIFI_MONITOR else "0")
    hdr("X-Runner-Wifi-Detail", ",".join(WIFI_DETAIL))
    # Until our first successful job poll, tell the portal we just (re)started so
    # it requeues any jobs still marked "running" under us from a previous process
    # (e.g. after a self-update / crash) — otherwise they'd sit stuck forever.
    if BOOT:
        hdr("X-Runner-Boot", "1")
    with MAINT_LOCK:
        _maint = MAINT
    if _maint and _maint != "idle":
        hdr("X-Runner-Maint", _maint)
    # Read the cached telemetry snapshot (populated by the stats thread). This is a
    # plain dict copy — it never spawns a subprocess or blocks, so a slow stat read
    # can never stall this request (and thus the heartbeat).
    with _STATS_LOCK:
        st = dict(_STATS)
    # Only send the installed-tools list when we actually have one. Sending an
    # empty header during the brief startup window (before the stats cache primes)
    # would otherwise blank the portal's tool list.
    _inst = st.get("installed") or []
    if _inst:
        hdr("X-Runner-Installed", ",".join(_inst))
    _num = {
        "X-Runner-Cpu": "cpu", "X-Runner-Mem": "mem", "X-Runner-Temp": "temp",
        "X-Runner-Mem-Used": "mem_used", "X-Runner-Mem-Total": "mem_total",
        "X-Runner-Disk-Used": "disk_used", "X-Runner-Disk-Total": "disk_total",
        "X-Runner-Cores": "cores", "X-Runner-Uptime": "uptime", "X-Runner-Gpu": "gpu",
        "X-Runner-Battery": "battery", "X-Runner-Charging": "charging", "X-Runner-Power": "power",
    }
    for header, key in _num.items():
        val = st.get(key)
        if val is not None:
            hdr(header, str(val))
    if st.get("load"):
        hdr("X-Runner-Load", st["load"])
    if data is not None:
        hdr("Content-Type", "application/json")
    return urllib.request.urlopen(req, timeout=timeout)


def post_with_retry(path: str, body, what: str) -> bool:
    """POST a result with retries — the DB may be cold (Vercel/Neon) and slow to
    wake, so the first attempt can time out. Returns True on success."""
    for attempt in range(4):
        try:
            request("POST", path, body, timeout=60)
            return True
        except urllib.error.HTTPError as e:
            # Token rotated out from under us mid-job → re-enroll and retry now with
            # the fresh token, so a result isn't lost to a 401.
            if e.code == 401 and reenroll_on_401():
                continue
            if attempt == 3:
                print(f"  posting {what} failed (try 4/4): HTTP {e.code}")
                break
            wait = 2 ** attempt
            print(f"  posting {what} failed (try {attempt + 1}/4): HTTP {e.code} — retrying in {wait}s")
            time.sleep(wait)
        except Exception as e:  # noqa: BLE001
            if attempt == 3:  # last try — don't sleep before giving up
                print(f"  posting {what} failed (try 4/4): {e}")
                break
            wait = 2 ** attempt
            print(f"  posting {what} failed (try {attempt + 1}/4): {e} — retrying in {wait}s")
            time.sleep(wait)
    print(f"  ✗ could not post {what}. The job will time out on the portal; use Retry there.")
    return False


# ---- Self-update -----------------------------------------------------------
# So you never have to re-pull/re-run the runner by hand. The runner fetches the
# latest script from the portal, and if its RUNNER_VERSION is newer than ours it
# overwrites this file and re-execs itself. Default on; set RUNNER_AUTO_UPDATE=0
# to disable (e.g. if you run from a pinned/edited copy).
AUTO_UPDATE = os.environ.get("RUNNER_AUTO_UPDATE", "1") not in ("0", "false", "no")
# Check for a newer script this often (in addition to once at startup, and
# opportunistically whenever the runner goes idle). Kept short so updates land
# quickly; it's just a cheap HTTPS GET.
UPDATE_CHECK_SECONDS = int(os.environ.get("UPDATE_CHECK_SECONDS", str(300)))
# Version scheme (from v52): a dotted string. A whole-number bump (52 → 53) is a
# major change; a dotted bump (52.1, 52.1.1) is a minor one. Compared as an
# integer tuple so "52.1" > "52" and "53" > "52.9".
_VERSION_RE = re.compile(r'^RUNNER_VERSION\s*=\s*["\'](\d+(?:\.\d+)*)["\']', re.MULTILINE)


def _ver_tuple(v: str) -> tuple:
    """Parse a dotted version ('52.1.1') into a comparable int tuple. Non-numeric
    or empty parts degrade to 0; trailing zeros are stripped so '52.0' == '52'."""
    out = []
    for part in str(v).split("."):
        try:
            out.append(int(part))
        except (TypeError, ValueError):
            out.append(0)
    while len(out) > 1 and out[-1] == 0:
        out.pop()
    return tuple(out) or (0,)


def _fetch_update():
    """Return the latest runner script text iff it's NEWER than ours, else None.
    Best-effort; validates the payload so a stray HTML error page can't clobber
    us. Does the (slow) network fetch, so callers run it OUTSIDE any lock."""
    if not AUTO_UPDATE:
        return None
    try:
        resp = request("GET", "/api/runner/script", timeout=30)
        content = resp.read().decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001
        # Older portals won't have this endpoint — that's fine, stay on current.
        print(f"  self-update check skipped: {exc}")
        return None

    # Sanity-check the payload so a stray HTML error page can never clobber us.
    if not content.startswith("#!") or "def main" not in content:
        return None
    m = _VERSION_RE.search(content)
    if not m:
        return None
    if _ver_tuple(m.group(1)) <= _ver_tuple(RUNNER_VERSION):
        return None
    return content


def _apply_update(content) -> bool:
    """Overwrite this script atomically and re-exec. Does not return on success
    (os.execv replaces the process). Returns False only if the write failed."""
    m = _VERSION_RE.search(content)
    remote = m.group(1) if m else "?"
    path = os.path.abspath(__file__)
    try:
        # Write atomically (tmp + replace) so a crash mid-write can't truncate
        # the running script.
        tmp = path + ".new"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp, path)
        os.chmod(path, 0o755)
    except Exception as exc:  # noqa: BLE001
        print(f"  self-update could not write {path}: {exc}")
        return False

    print(f"⬆ updated runner {RUNNER_VERSION} → {remote}; restarting…")
    _release_single_instance()  # let the re-exec'd process re-acquire the lock
    try:
        os.execv(sys.executable, [sys.executable, path] + sys.argv[1:])
    except Exception as exc:  # noqa: BLE001
        # If re-exec fails, the new file is in place for the next manual start.
        print(f"  restart failed ({exc}); please restart the runner.")
    return True


def self_update() -> bool:
    """Startup convenience: fetch + apply if newer. Called before any worker
    threads start, so no idle guard is needed here."""
    content = _fetch_update()
    return _apply_update(content) if content else False


def restart_self():
    """Re-exec this runner (portal-requested restart from the Machines page).
    Startup runs self_update() first, so a restart also lands the latest version.
    os.execv replaces the whole process, so this never returns on success."""
    path = os.path.abspath(__file__)
    print("↻ restart requested from portal — restarting…")
    try:
        sys.stdout.flush()
    except Exception:  # noqa: BLE001
        pass
    _release_single_instance()  # let the re-exec'd process re-acquire the lock
    try:
        os.execv(sys.executable, [sys.executable, path] + sys.argv[1:])
    except Exception as exc:  # noqa: BLE001
        print(f"  restart failed ({exc}); please restart the runner manually.")


def maybe_self_update():
    """Called from the main loop only when the runner is idle (no jobs running).
    Throttled to UPDATE_CHECK_SECONDS. Safe to apply here: we're on the main
    thread with zero active workers, so nothing gets interrupted."""
    content = _fetch_update()
    if content:
        _apply_update(content)  # writes + re-execs; won't return


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


def tor_exit_ip(retries: int = 3, delay: int = 5) -> str:
    """Fetch the Tor exit IP, retrying while Tor finishes bootstrapping."""
    if not (shutil.which("torsocks") and shutil.which("curl")):
        return ""
    for attempt in range(retries):
        try:
            r = subprocess.run(
                ["torsocks", "curl", "-s", "--max-time", "20", "https://api.ipify.org"],
                capture_output=True,
                text=True,
                timeout=30,
            )
            ip = (r.stdout or "").strip()
            if ip and re.match(r"^[0-9a-fA-F:.]+$", ip):
                return ip
        except Exception:  # noqa: BLE001
            pass
        if attempt < retries - 1:
            time.sleep(delay)
    return ""


def apply_anonymity(on: bool) -> None:
    """Reconcile local Tor state with the portal's desired setting. Retried on
    every poll while ON, so a slow Tor bootstrap eventually succeeds."""
    global ANON_ON, EXIT_IP, ANON_STATUS
    if on and not ANON_ON:
        if not (shutil.which("torsocks") and shutil.which("tor")):
            if ANON_STATUS != "no-tor":
                print("  tor/torsocks not installed — run: sudo apt install -y tor torsocks")
            ANON_STATUS = "no-tor"
            return
        if ANON_STATUS != "connecting":
            print("🧅 Enabling Tor anonymity…")
        if ensure_tor():
            ANON_ON = True
            EXIT_IP = tor_exit_ip()
            ANON_STATUS = "on" if EXIT_IP else "connecting"
            print(f"  Tor on — exit IP {EXIT_IP or '(bootstrapping…)'}")
        else:
            ANON_STATUS = "connecting"  # keep retrying on the next poll
    elif not on and ANON_ON:
        print("Disabling Tor anonymity.")
        ANON_ON = False
        EXIT_IP = ""
        ANON_STATUS = "off"
    elif not on:
        ANON_STATUS = "off"


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
            reenroll_on_401()  # self-heal, don't die — keep the current tool list
            return None
        return None  # older portal without the route, etc. — keep current list
    except Exception:  # noqa: BLE001
        return None


# --- Network self-recovery ---------------------------------------------------
# The #1 way this box loses connectivity is a WiFi-attack workflow: monitor mode
# / `airmon-ng check kill` can take down NetworkManager (and with it ethernet) on
# the very interface the runner uses to reach the portal — and then it can't
# receive a "stop monitor" job, so it stays dead until a manual reboot. This
# watchdog notices a *sustained* portal outage that is also a *local* network
# outage (not just the portal being down) and restores managed networking on its
# own: stop monitor mode, re-manage interfaces, unblock rfkill, restart NM.
PING_FAILS = 0


def _internet_reachable() -> bool:
    """True if we can open a TCP socket to a public resolver. Distinguishes a
    LOCAL network outage from the portal itself being unreachable (don't touch the
    network — that would needlessly disrupt a real capture)."""
    import socket

    for host in (("1.1.1.1", 53), ("8.8.8.8", 53)):
        try:
            s = socket.create_connection(host, timeout=4)
            s.close()
            return True
        except Exception:  # noqa: BLE001
            continue
    return False


def heartbeat_loop():
    """Background: keep the machine 'online' regardless of what the loop is doing.
    While every worker is busy with a long job, the main loop stops polling, so
    this is the ONLY thing pinging the portal — it must NEVER die. It is now a PURE
    pinger: telemetry + WiFi re-detection happen on the stats thread, so nothing a
    heartbeat does can spawn a subprocess or block. Every pass is fully guarded;
    check_cancellations runs inside the guard too, and it self-heals the Tor exit
    IP once bootstrapping completes."""
    global EXIT_IP, ANON_STATUS, PING_FAILS
    beat = 0
    while True:
        try:
            if ANON_ON and not EXIT_IP:
                ip = tor_exit_ip(retries=1)
                if ip:
                    EXIT_IP = ip
                    ANON_STATUS = "on"
                    print(f"  Tor exit IP {ip}")
            # Ping to stay "online". The portal does a cheap lastSeenAt-only write
            # for these, so a busy box can't time them out; every ~5th beat we ask
            # for a full stats write (?full=1) to refresh the resource monitor.
            # Short timeout + one quick retry + frequent beats = never miss the
            # online window even if the portal is briefly slow.
            beat += 1
            path = "/api/runner/ping" + ("?full=1" if beat % 5 == 0 else "")
            resp = None
            for attempt in range(2):
                try:
                    resp = request("GET", path, timeout=8)
                    break
                except Exception:  # noqa: BLE001
                    if attempt == 0:
                        time.sleep(1)
                    else:
                        raise
            # Log the transition back to reachable so the console makes the state
            # obvious (it only prints on CHANGE, not every beat).
            if PING_FAILS > 0:
                note(f"portal reachable again after {PING_FAILS} failed ping(s) — machine online")
                _notify("Runner reconnected", "The machine is back online.")
            with _STATUS_LOCK:
                _STATUS["connected"] = True
                _STATUS["last_ok"] = time.time()
                _STATUS["last_error"] = ""
            PING_FAILS = 0
            # Honor a portal-requested restart (Machines page → Restart). Re-exec
            # picks up the latest script via self-update on startup.
            try:
                if resp is not None and resp.getheader("X-Runner-Command") == "restart":
                    restart_self()  # does not return
            except Exception:  # noqa: BLE001
                pass
            # Kill any jobs canceled from the portal so their worker slots free up.
            check_cancellations()
        except Exception as e:  # noqa: BLE001 — the heartbeat must NEVER die
            # A failed ping just counts; the connection_guardian thread owns all
            # local-network recovery (it probes + escalates continuously), so the
            # heartbeat stays a pure, lightweight pinger and the two never fight.
            if PING_FAILS == 0:
                note(f"can't reach the portal — machine will show OFFLINE. ({e})", err=True)
                _notify("Runner offline", "Lost connection to the portal — trying to reconnect.")
            with _STATUS_LOCK:
                _STATUS["connected"] = False
            PING_FAILS += 1
        time.sleep(PING_SECONDS)


def _handle_stream_event(event, data):
    """React to one Server-Sent Event from the portal command stream."""
    if event == "wake":
        WAKE.set()                       # queued work — poll now, don't wait
    elif event == "restart":
        restart_self()                   # does not return
    elif event == "cancel":
        try:
            check_cancellations()        # kill any portal-canceled jobs
        except Exception:  # noqa: BLE001
            pass
        WAKE.set()
    elif event == "control":
        # Interactive control frame (PTY keystroke/resize, file/proc/svc/install).
        try:
            handle_control(data)
        except Exception:  # noqa: BLE001 — one bad frame must not kill the stream
            pass
    # "hello" / "ping": presence is handled server-side; nothing to do.


def stream_loop():
    """Hold a live Server-Sent Events connection to the portal (the PUSH half of
    the channel). While it's open the portal both marks this machine online
    (presence) and pushes commands — 'wake' (claim queued work now), 'cancel',
    'restart'. This makes job pickup instant instead of waiting for the poll tick.

    Pure accelerator + presence: if the stream can't connect (older portal, a
    proxy that strips SSE), this loop just keeps retrying while the normal poll +
    heartbeat carry on unchanged. Never dies. Stdlib only — we iterate the response
    line by line as bytes arrive."""
    backoff = 2
    while True:
        try:
            # Pass the last control-input seq we applied so a reconnect never
            # replays keystrokes we already ran.
            resp = request("GET", f"/api/runner/stream?controlAfter={CONTROL_SEQ}",
                           timeout=STREAM_TIMEOUT)
            backoff = 2  # connected — reset backoff
            event = None
            for raw in resp:  # HTTPResponse yields lines as they arrive
                try:
                    line = raw.decode("utf-8", "replace").rstrip("\r\n")
                except Exception:  # noqa: BLE001
                    continue
                if line.startswith("event:"):
                    event = line[6:].strip()
                elif line.startswith("data:"):
                    payload = line[5:].strip()
                    try:
                        data = json.loads(payload) if payload else {}
                    except Exception:  # noqa: BLE001
                        data = {}
                    _handle_stream_event(event, data)
                    event = None
                elif line == "":
                    event = None
            # Clean end-of-stream (the endpoint closes after ~25s) → reconnect now.
        except urllib.error.HTTPError as e:
            if e.code == 401:
                # Token rejected mid-stream → self-heal in place, then back off
                # briefly so the reconnect picks up the fresh token.
                reenroll_on_401()
                time.sleep(15)
            elif e.code == 404:
                # Portal doesn't have the stream yet — fall back quietly to poll.
                time.sleep(60)
            else:
                time.sleep(backoff)
                backoff = min(30, backoff * 2)
        except Exception:  # noqa: BLE001 — stream must never kill the runner
            time.sleep(backoff)
            backoff = min(30, backoff * 2)


# ── Interactive control: PTY terminal, files, processes, services, install ───
# The portal streams us "control" frames (dir=in); we run them and stream output
# back via POST /api/runner/control/msg (dir=out). This is full remote control —
# gated on the PORTAL side by an owner-granted, time-boxed unlock. Stdlib only.
CONTROL_SEQ = 0                    # last control-input seq we've applied (sent as ?controlAfter)
CONTROL_LOCK = threading.Lock()
CONTROL_SESSIONS = {}             # sessionId -> {"fd","pid","alive"}
UPLOAD_BUFS = {}                  # sessionId -> {"path", "chunks":[...]}
MAX_PTY_SESSIONS = 4


def _cjson(s):
    """Parse a control-frame data payload (JSON string or dict) → dict."""
    if isinstance(s, dict):
        return s
    try:
        return json.loads(s) if s else {}
    except Exception:  # noqa: BLE001
        return {}


def control_post(session_id, messages):
    """POST output frames for a session to the portal (best-effort)."""
    if not messages:
        return
    try:
        request("POST", "/api/runner/control/msg",
                {"sessionId": session_id, "messages": messages}, timeout=15)
    except Exception:  # noqa: BLE001
        pass


def _control_out(session_id, kind, data=""):
    control_post(session_id, [{"kind": kind, "data": data}])


def _set_winsize(fd, rows, cols):
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    except Exception:  # noqa: BLE001
        pass


def _pty_reader(session_id, master_fd):
    """Stream PTY output back, coalescing ~40ms bursts so keystroke echoes don't
    each become a request."""
    while True:
        try:
            r, _, _ = select.select([master_fd], [], [], 0.3)
            if master_fd not in r:
                sess = CONTROL_SESSIONS.get(session_id)
                if not sess or not sess.get("alive"):
                    break
                continue
            chunk = os.read(master_fd, 65536)
            if not chunk:
                break
            parts = [chunk]
            deadline = time.monotonic() + 0.04
            while time.monotonic() < deadline:
                r2, _, _ = select.select([master_fd], [], [], 0.01)
                if master_fd not in r2:
                    break
                more = os.read(master_fd, 65536)
                if not more:
                    break
                parts.append(more)
            _control_out(session_id, "data", base64.b64encode(b"".join(parts)).decode())
            sess = CONTROL_SESSIONS.get(session_id)
            if sess:
                sess["ts"] = time.monotonic()
        except (OSError, ValueError):
            break
        except Exception:  # noqa: BLE001
            break
    _pty_cleanup(session_id, notify=True)


def _pty_open(session_id, cols, rows, as_root):
    with CONTROL_LOCK:
        if session_id in CONTROL_SESSIONS:
            return  # already open
        if sum(1 for s in CONTROL_SESSIONS.values() if s.get("alive")) >= MAX_PTY_SESSIONS:
            _control_out(session_id, "error", "too many open terminals on this machine")
            return
    try:
        pid, master_fd = pty.fork()
    except Exception as e:  # noqa: BLE001
        _control_out(session_id, "error", f"pty failed: {e}")
        return
    if pid == 0:  # child — becomes the shell
        os.environ["TERM"] = "xterm-256color"
        if as_root and os.geteuid() != 0:
            os.execvp("sudo", ["sudo", "-S", "-i"])
        else:
            shell = os.environ.get("SHELL") or "/bin/bash"
            try:
                os.execvp(shell, [shell, "-il"])
            except Exception:  # noqa: BLE001
                os.execvp("/bin/sh", ["/bin/sh", "-i"])
        os._exit(1)
    # parent
    _set_winsize(master_fd, rows, cols)
    CONTROL_SESSIONS[session_id] = {"fd": master_fd, "pid": pid, "alive": True,
                                    "ts": time.monotonic()}
    # Rooting via `sudo -S`: feed the machine-side password once (never leaves the box).
    if as_root and os.geteuid() != 0:
        sp = os.environ.get("RUNNER_SUDO_PASS", "")
        if sp:
            try:
                os.write(master_fd, (sp + "\n").encode())
            except Exception:  # noqa: BLE001
                pass
    _control_out(session_id, "open", "")
    threading.Thread(target=_pty_reader, args=(session_id, master_fd), daemon=True).start()


def _pty_write(session_id, data_b64):
    sess = CONTROL_SESSIONS.get(session_id)
    if not sess or not sess.get("alive"):
        return
    try:
        os.write(sess["fd"], base64.b64decode(data_b64))
        sess["ts"] = time.monotonic()  # activity — keeps the idle reaper away
    except Exception:  # noqa: BLE001
        pass


def _pty_cleanup(session_id, notify=False):
    sess = CONTROL_SESSIONS.pop(session_id, None)
    UPLOAD_BUFS.pop(session_id, None)
    if not sess:
        return
    sess["alive"] = False
    code = None
    try:
        os.close(sess["fd"])
    except Exception:  # noqa: BLE001
        pass
    try:
        _, status = os.waitpid(sess["pid"], os.WNOHANG)
        code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else None
    except Exception:  # noqa: BLE001
        pass
    try:
        os.kill(sess["pid"], 9)
    except Exception:  # noqa: BLE001
        pass
    if notify:
        _control_out(session_id, "exit", "" if code is None else str(code))


def _do_proc(sid):
    try:
        p = subprocess.run(["ps", "-eo", "pid,ppid,user,pcpu,pmem,etime,comm", "--sort=-pcpu"],
                           capture_output=True, text=True, timeout=15)
        _control_out(sid, "proc", base64.b64encode((p.stdout or "").encode()).decode())
    except Exception as e:  # noqa: BLE001
        _control_out(sid, "error", str(e))


def _do_ls(sid, path):
    try:
        path = path or os.path.expanduser("~")
        entries = []
        with os.scandir(path) as it:
            for e in it:
                try:
                    st = e.stat(follow_symlinks=False)
                    entries.append({"name": e.name, "dir": e.is_dir(), "size": st.st_size,
                                    "mtime": int(st.st_mtime)})
                except Exception:  # noqa: BLE001
                    entries.append({"name": e.name, "dir": False})
        entries.sort(key=lambda x: (not x["dir"], x["name"].lower()))
        _control_out(sid, "ls", json.dumps({"path": os.path.abspath(path), "entries": entries[:3000]}))
    except Exception as e:  # noqa: BLE001
        _control_out(sid, "error", f"ls: {e}")


def _do_download(sid, path):
    try:
        with open(path, "rb") as f:
            while True:
                chunk = f.read(48000)
                if not chunk:
                    break
                _control_out(sid, "file-chunk", base64.b64encode(chunk).decode())
        _control_out(sid, "file-eof", os.path.basename(path))
    except Exception as e:  # noqa: BLE001
        _control_out(sid, "error", f"download: {e}")


def _do_service(sid, action, unit):
    if action not in ("start", "stop", "restart", "status") or not re.match(r"^[A-Za-z0-9_.@:-]+$", unit or ""):
        _control_out(sid, "error", "bad service request")
        return
    sudo, stdin_in = _sudo_prefix()
    try:
        p = subprocess.run(sudo + ["systemctl", action, unit], input=stdin_in,
                           capture_output=True, text=True, timeout=30)
        _control_out(sid, "svc", base64.b64encode(((p.stdout or "") + (p.stderr or "")).encode()).decode())
    except Exception as e:  # noqa: BLE001
        _control_out(sid, "error", f"service: {e}")


def _do_install_pkg(sid, pkg):
    if not re.match(r"^[a-z0-9][a-z0-9+._-]*$", pkg or ""):
        _control_out(sid, "error", "invalid package name")
        return
    sudo, stdin_in = _sudo_prefix()
    env = {**os.environ, "DEBIAN_FRONTEND": "noninteractive"}
    try:
        p = subprocess.run(sudo + ["apt-get", "install", "-y", pkg], input=stdin_in, env=env,
                           capture_output=True, text=True, timeout=INSTALL_TIMEOUT)
        _control_out(sid, "install", base64.b64encode(((p.stdout or "") + (p.stderr or "")).encode()).decode())
    except Exception as e:  # noqa: BLE001
        _control_out(sid, "error", f"install: {e}")


def handle_control(frame):
    """Apply one control frame from the portal (runs on the stream thread; spawns
    a worker for anything that could block)."""
    global CONTROL_SEQ
    seq = frame.get("seq")
    if isinstance(seq, int) and seq > CONTROL_SEQ:
        CONTROL_SEQ = seq
    sid = frame.get("sessionId") or ""
    kind = frame.get("kind") or ""
    data = frame.get("data", "")
    if not sid:
        return
    if kind == "open":
        d = _cjson(data)
        _pty_open(sid, int(d.get("cols", 80)), int(d.get("rows", 24)), bool(d.get("asRoot")))
    elif kind == "data":
        _pty_write(sid, data)
    elif kind == "resize":
        d = _cjson(data)
        sess = CONTROL_SESSIONS.get(sid)
        if sess:
            _set_winsize(sess["fd"], int(d.get("rows", 24)), int(d.get("cols", 80)))
    elif kind == "signal":
        _pty_write(sid, base64.b64encode(b"\x03").decode())  # Ctrl-C
    elif kind == "close":
        _pty_cleanup(sid, notify=True)
    elif kind == "proc":
        threading.Thread(target=_do_proc, args=(sid,), daemon=True).start()
    elif kind == "ls":
        threading.Thread(target=_do_ls, args=(sid, _cjson(data).get("path", "")), daemon=True).start()
    elif kind == "download":
        threading.Thread(target=_do_download, args=(sid, _cjson(data).get("path", "")), daemon=True).start()
    elif kind == "svc":
        d = _cjson(data)
        threading.Thread(target=_do_service, args=(sid, d.get("action", ""), d.get("unit", "")), daemon=True).start()
    elif kind == "install":
        threading.Thread(target=_do_install_pkg, args=(sid, _cjson(data).get("pkg", "")), daemon=True).start()
    elif kind == "file-open":          # upload: begin buffering
        UPLOAD_BUFS[sid] = {"path": _cjson(data).get("path", ""), "chunks": []}
    elif kind == "file-chunk":         # upload: append
        buf = UPLOAD_BUFS.get(sid)
        if buf is not None:
            try:
                buf["chunks"].append(base64.b64decode(data))
            except Exception:  # noqa: BLE001
                pass
    elif kind == "file-eof":           # upload: flush to disk
        buf = UPLOAD_BUFS.pop(sid, None)
        if buf and buf.get("path"):
            try:
                with open(buf["path"], "wb") as f:
                    f.write(b"".join(buf["chunks"]))
                _control_out(sid, "file-eof", os.path.basename(buf["path"]))
            except Exception as e:  # noqa: BLE001
                _control_out(sid, "error", f"upload: {e}")


CONTROL_IDLE_SECONDS = int(os.environ.get("CONTROL_IDLE_SECONDS", "1200"))  # 20 min


def control_reaper():
    """Close interactive sessions idle too long — so a crashed/closed browser tab
    never leaves a shell running forever on the machine. Never dies."""
    while True:
        try:
            now = time.monotonic()
            stale = [sid for sid, s in list(CONTROL_SESSIONS.items())
                     if now - s.get("ts", now) > CONTROL_IDLE_SECONDS]
            for sid in stale:
                _pty_cleanup(sid, notify=True)
        except Exception:  # noqa: BLE001
            pass
        time.sleep(60)


# Nuclei templates must be present (and current) for nuclei to find anything.
# Refresh them on startup and then once a day, in the background, so the operator
# never has to remember `nuclei -update-templates`.
NUCLEI_UPDATE_SECONDS = int(os.environ.get("NUCLEI_UPDATE_SECONDS", str(24 * 3600)))


def update_nuclei_templates():
    """Run `nuclei -update-templates` if nuclei is installed. Best-effort."""
    bin_ = (TOOLS.get("nuclei") or {}).get("bin", "nuclei")
    if not shutil.which(bin_):
        return
    try:
        print("⬇ updating nuclei templates…")
        r = subprocess.run(
            [bin_, "-update-templates"],
            capture_output=True,
            text=True,
            timeout=600,
        )
        ok = r.returncode == 0
        print(f"  nuclei templates {'updated' if ok else 'update failed'} (exit {r.returncode})")
    except Exception as exc:  # noqa: BLE001
        print(f"  nuclei template update skipped: {exc}")


def nuclei_template_loop():
    """Background: keep nuclei templates fresh on startup and daily."""
    while True:
        update_nuclei_templates()
        time.sleep(NUCLEI_UPDATE_SECONDS)


# Threat intel: the runner has internet egress, so it fetches the CISA KEV
# catalog (CVEs actively exploited in the wild) and syncs it to the portal — the
# portal then flags KEV findings as urgent without needing outbound access.
KEV_URL = os.environ.get(
    "KEV_URL",
    "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
)
KEV_SYNC_SECONDS = int(os.environ.get("KEV_SYNC_SECONDS", str(24 * 3600)))


def sync_threat_intel():
    """Fetch the CISA KEV catalog and POST its CVE ids to the portal. Best-effort."""
    try:
        req = urllib.request.Request(KEV_URL, headers={"User-Agent": "rdaisec-runner"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode())
        cves = [v.get("cveID") for v in data.get("vulnerabilities", []) if v.get("cveID")]
        if not cves:
            return
        request("POST", "/api/runner/intel", {"kind": "kev", "cves": cves}, timeout=60)
        print(f"  synced CISA KEV ({len(cves)} actively-exploited CVEs) to the portal")
    except Exception as exc:  # noqa: BLE001 — best-effort, never crash the runner
        print(f"  KEV sync skipped: {exc}")


# EPSS: exploit-prediction scores (probability a CVE is exploited in the next 30
# days). The runner fetches the daily bulk feed and syncs the actionable subset
# (score ≥ 0.1) to the portal, which factors it into risk scoring. Best-effort.
EPSS_URL = os.environ.get("EPSS_URL", "https://epss.cyentia.com/epss_scores-current.csv.gz")
EPSS_MIN = float(os.environ.get("EPSS_MIN", "0.1"))


def sync_epss():
    """Fetch the EPSS bulk CSV, keep CVEs at/above the threshold, POST to portal."""
    try:
        import gzip

        req = urllib.request.Request(EPSS_URL, headers={"User-Agent": "rdaisec-runner"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read()
        text = gzip.decompress(raw).decode("utf-8", "replace") if raw[:2] == b"\x1f\x8b" else raw.decode("utf-8", "replace")
        scores = {}
        for line in text.splitlines():
            if not line or line[0] == "#" or line[:3].lower() == "cve":
                continue
            parts = line.split(",")
            if len(parts) < 2:
                continue
            cve = parts[0].strip().upper()
            if not cve.startswith("CVE-"):
                continue
            try:
                e = float(parts[1])
            except ValueError:
                continue
            if e >= EPSS_MIN:
                scores[cve] = round(e, 4)
        if not scores:
            return
        request("POST", "/api/runner/intel", {"kind": "epss", "scores": scores}, timeout=120)
        print(f"  synced EPSS ({len(scores)} CVEs ≥{EPSS_MIN}) to the portal")
    except Exception as exc:  # noqa: BLE001 — best-effort, never crash the runner
        print(f"  EPSS sync skipped: {exc}")


def threat_intel_loop():
    """Background: sync the CISA KEV catalog + EPSS scores on startup and daily."""
    while True:
        sync_threat_intel()
        sync_epss()
        time.sleep(KEV_SYNC_SECONDS)


# ── Daily self-heal / maintenance ───────────────────────────────────────────
def set_maint(stage: str, pct=None, note: str = ""):
    """Record the current maintenance stage and push it to the portal promptly
    (the header goes out on the very next ping regardless, but we fire one now so
    the live pipeline moves in step with the machine). Best-effort."""
    global MAINT
    note = (note or "").replace("|", "/").replace("\n", " ")[:200]
    parts = [stage, "" if pct is None else str(int(pct)), note]
    with MAINT_LOCK:
        MAINT = "|".join(parts)
    print(f"  ⟳ maintenance: {stage}" + (f" — {note}" if note else ""))
    try:
        request("GET", "/api/runner/ping", timeout=15)
    except Exception:  # noqa: BLE001 — reporting is best-effort
        pass


def _maint_cmd(argv, timeout=900):
    """Run one maintenance command, guarded. Returns (ok, output_tail)."""
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
        tail = ((r.stdout or "") + (r.stderr or "")).strip()[-400:]
        return r.returncode == 0, tail
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)[:400]


def _has_apt():
    return shutil.which("apt-get") is not None


def _apt(*args, timeout=1800):
    """apt-get wrapper — uses sudo -n when not already root. Non-interactive."""
    base = [] if os.geteuid() == 0 else (["sudo", "-n"] if shutil.which("sudo") else None)
    if base is None:
        return False, "no root/sudo"
    env_prefix = ["env", "DEBIAN_FRONTEND=noninteractive"]
    return _maint_cmd(base + env_prefix + ["apt-get", "-y", *args], timeout=timeout)


def run_maintenance():
    """Walk the maintenance pipeline once, reporting each stage. Every step is
    best-effort — a failure is noted and the pass continues so the machine still
    gets whatever upkeep it can. Reports 'done' (or 'failed') at the end."""
    problems = []
    apt = _has_apt()

    set_maint("starting", 2, "Pre-flight checks")

    # 1) Refresh the package index (what's available to install/upgrade).
    set_maint("updating", 15, "Refreshing package index" if apt else "No apt — skipping")
    if apt:
        ok, tail = _apt("update", timeout=600)
        if not ok:
            problems.append("apt update failed")

    # 2) Upgrade installed packages — OFF by default. A full unattended upgrade can
    #    restart networking/systemd and take the machine offline, so it only runs
    #    when explicitly opted in via MAINT_APT_UPGRADE=1.
    if apt and MAINT_APT_UPGRADE:
        set_maint("upgrading", 35, "Upgrading packages (opt-in)")
        # --with-new-pkgs avoids held-back kernels; still user-authorized via env.
        ok, tail = _apt("upgrade", "--with-new-pkgs", timeout=2400)
        if not ok:
            problems.append("apt upgrade incomplete")
    else:
        set_maint("upgrading", 35, "Package upgrade skipped (safe mode)")

    # 3) Free disk: stale temp + tool caches + journal (all safe — no package
    #    removal, no service restarts). Shared with the periodic cleanup loop.
    set_maint("cleaning", 55, "Freeing disk space & temp")
    run_cleanup()

    # 4) Refresh tool databases so scans actually match today's issues.
    set_maint("refreshing", 72, "Updating scanner templates & exploit DB")
    try:
        update_nuclei_templates()
    except Exception:  # noqa: BLE001
        problems.append("nuclei templates")
    if shutil.which("searchsploit"):
        _maint_cmd(["searchsploit", "-u"], timeout=600)
    try:
        sync_threat_intel()
        sync_epss()
    except Exception:  # noqa: BLE001
        problems.append("threat intel")

    # 5) Self-test: confirm the allowlisted tools are actually present.
    set_maint("verifying", 90, "Verifying tools")
    present = installed_tools()
    missing = [t for t in TOOLS if t not in present]
    if missing:
        problems.append(f"{len(missing)} tool(s) missing")

    # 6) Report the outcome.
    set_maint("reporting", 98, "Posting summary")
    if problems:
        summary = "Completed with notes: " + "; ".join(problems[:4])
        set_maint("failed", 100, summary)
    else:
        summary = f"Up to date · {len(present)} tools healthy"
        set_maint("done", 100, summary)


def maintenance_loop():
    """Background: once a day inside the quiet window, run the maintenance pass.
    Tracks the last run date so it fires exactly once per day even though it wakes
    frequently. Never crashes — the whole body is guarded."""
    last_run_day = None
    # Report idle at rest so the portal knows maintenance is armed, not stale.
    set_maint("idle", 0, f"Scheduled daily {MAINT_START_HOUR:02d}:00–{MAINT_END_HOUR:02d}:00")
    while True:
        try:
            if MAINT_ENABLED:
                now = time.localtime()
                today = (now.tm_year, now.tm_yday)
                in_window = MAINT_START_HOUR <= now.tm_hour < MAINT_END_HOUR
                if in_window and today != last_run_day:
                    last_run_day = today
                    try:
                        run_maintenance()
                    except Exception as exc:  # noqa: BLE001
                        set_maint("failed", 100, f"Maintenance error: {exc}")
                    # Return to idle a little after finishing so the pipeline shows
                    # 'done', then the badge relaxes on the next cycle.
                    time.sleep(300)
                    set_maint("idle", 0, f"Next pass {MAINT_START_HOUR:02d}:00–{MAINT_END_HOUR:02d}:00")
        except Exception:  # noqa: BLE001 — maintenance must never take the runner down
            pass
        time.sleep(120)


# ── Housekeeping: keep the runner's disk healthy ─────────────────────────────
def _rm_old_temp() -> int:
    """Remove the runner's OWN stale temp files (and common capture leftovers)
    older than TEMP_MAX_AGE, so a fresh/active job is never disturbed. Only touches
    files we recognise — never a blanket /tmp wipe. Returns the count removed."""
    removed = 0
    now = time.time()
    tor_running = _tor_proc is not None and _tor_proc.poll() is None
    try:
        for name in os.listdir("/tmp"):
            path = os.path.join("/tmp", name)
            ours = name.startswith(("rdsurvey", "rdaisec", "rdmon", "rdcap"))
            # airodump / capture leftovers this runner's WiFi flows produce.
            capture = name.endswith((".cap", ".pcap", ".netxml", ".kismet.csv", ".kismet.netxml", ".22000", ".hccapx")) or bool(re.search(r"-\d\d\.(csv|cap|kismet\.csv)$", name))
            if not (ours or capture):
                continue
            if name == "rdaisec-tor" and tor_running:
                continue  # active Tor data dir
            try:
                if now - os.path.getmtime(path) < TEMP_MAX_AGE:
                    continue  # too fresh — may belong to a running job
                if os.path.isdir(path):
                    shutil.rmtree(path, ignore_errors=True)
                else:
                    os.remove(path)
                removed += 1
            except Exception:  # noqa: BLE001
                pass
    except Exception:  # noqa: BLE001
        pass
    return removed


def run_cleanup() -> str:
    """Clear stale temp + tool caches. All steps are safe (nothing that removes
    packages or restarts services). Returns a short summary. Never raises."""
    freed = _rm_old_temp()
    notes = [f"{freed} temp file(s)"]
    try:
        # Package-manager download cache (safe: just re-downloadable .debs).
        if shutil.which("apt-get"):
            _apt("autoclean", timeout=300)
            notes.append("apt cache")
        # pip wheel cache.
        for pip in ("pip3", "pip"):
            if shutil.which(pip):
                _maint_cmd([pip, "cache", "purge"], timeout=60)
                notes.append("pip cache")
                break
        # Trim the systemd journal so logs can't fill the disk.
        if shutil.which("journalctl"):
            _maint_cmd(["bash", "-lc", "journalctl --vacuum-size=200M"], timeout=120)
            notes.append("journal")
    except Exception:  # noqa: BLE001
        pass
    summary = "cleared " + ", ".join(notes)
    print(f"🧹 cleanup: {summary}")
    return summary


def cleanup_loop():
    """Background: periodic housekeeping between the daily maintenance passes."""
    while True:
        time.sleep(CLEANUP_SECONDS)
        try:
            run_cleanup()
        except Exception:  # noqa: BLE001
            pass


# ── Connection guardian: stay reachable in the hardest situations ────────────
def _portal_reachable() -> bool:
    """Cheap TCP connect to the portal host (no auth/DB) — is the portal itself
    reachable right now?"""
    import socket
    from urllib.parse import urlparse

    try:
        u = urlparse(PORTAL_URL)
        host = u.hostname
        port = u.port or (443 if u.scheme == "https" else 80)
        if not host:
            return False
        s = socket.create_connection((host, port), timeout=6)
        s.close()
        return True
    except Exception:  # noqa: BLE001
        return False


def connectivity_state() -> str:
    """'portal' = fully reachable · 'internet' = local net OK but portal down (don't
    touch the network) · 'down' = local network gone (needs recovery)."""
    if _portal_reachable():
        return "portal"
    if _internet_reachable():
        return "internet"
    return "down"


def restore_connectivity(level: int) -> None:
    """NON-DESTRUCTIVE recovery. The old escalating tiers (restart NetworkManager,
    `nmcli networking off/on`, bounce every interface, renew DHCP) were the very
    thing that took the box offline: in a VM a brief NAT blip reads as 'network
    down', and restarting the stack drops the uplink → deeper outage → escalation.

    The ONLY safe automatic fix for a runner that knocked ITSELF offline is undoing
    monitor mode on a NON-UPLINK adapter (a WiFi capture left a dongle in monitor
    mode). We never touch the uplink (the default-route interface), never restart
    NetworkManager, never bounce interfaces or renew DHCP. If the real uplink is
    down, the OS/NM own bringing it back; the runner just waits and keeps trying.
    `level` is kept for signature compatibility but no longer escalates. Never
    raises."""
    uplink = _default_route_iface()
    mons = [m for m in _monitor_ifaces() if m and m != uplink]
    if not mons:
        return  # nothing safe to undo — wait for the OS to restore the uplink
    print(f"⚠ connection guardian: dropping monitor mode on {', '.join(mons)} (non-uplink) to free networking")
    sudo, stdin_in = _sudo_prefix()

    def sh(argv, timeout=20):
        try:
            return subprocess.run(sudo + argv, input=stdin_in, capture_output=True, text=True, timeout=timeout)
        except Exception:  # noqa: BLE001
            return None

    for mon in mons:
        try:
            sh(["airmon-ng", "stop", mon], timeout=20)
            if mon in _monitor_ifaces():
                sh(["ip", "link", "set", mon, "down"])
                sh(["iw", "dev", mon, "set", "type", "managed"])
                sh(["ip", "link", "set", mon, "up"])
            sh(["nmcli", "dev", "set", mon, "managed", "yes"])
        except Exception:  # noqa: BLE001
            pass


def connection_guardian():
    """Background: watch reachability and, ONLY when the box has genuinely knocked
    itself off via monitor mode, undo that (non-destructively). It never restarts
    the network stack and never reboots the uplink, so it can't deepen an outage;
    it never gives up and never dies."""
    fails = 0
    down_since = None
    while True:
        try:
            state = connectivity_state()
            if state in ("portal", "internet"):
                # 'internet' = portal down but OUR network is fine → nothing to fix.
                if fails >= 3:
                    print("✓ connection guardian: connectivity restored")
                fails = 0
                down_since = None
            else:  # 'down' — require it to persist so a transient blip can't trigger us.
                fails += 1
                if down_since is None:
                    down_since = time.monotonic()
                if fails >= 3:
                    restore_connectivity(1)  # safe, idempotent, uplink-preserving
                if GUARDIAN_REBOOT and time.monotonic() - down_since > GUARDIAN_REBOOT_AFTER:
                    print("⚠ connection guardian: prolonged total outage — rebooting (GUARDIAN_REBOOT=1)")
                    try:
                        subprocess.run(["bash", "-lc", "sync; systemctl reboot || reboot"], timeout=30)
                    except Exception:  # noqa: BLE001
                        pass
                    down_since = time.monotonic()  # avoid a reboot loop
        except Exception:  # noqa: BLE001 — the guardian must NEVER die
            pass
        time.sleep(GUARDIAN_SECONDS)


def _apply_workers(headers):
    """Update parallelism live from the portal's X-Runner-Max-Workers header, so
    changing it on the Machines page takes effect without restarting the runner."""
    global MAX_WORKERS
    try:
        n = int(headers.get("X-Runner-Max-Workers", ""))
    except (TypeError, ValueError):
        return
    n = max(1, min(16, n))
    if n != MAX_WORKERS:
        print(f"⚙ concurrency changed: {MAX_WORKERS} → {n} parallel job(s)")
        MAX_WORKERS = n


def _apply_maint_schedule(headers):
    """Update the daily maintenance schedule live from the portal's
    X-Runner-Maint-Enabled / X-Runner-Maint-Window headers, so editing it on the
    Machines page takes effect without restarting the runner."""
    global MAINT_ENABLED, MAINT_START_HOUR, MAINT_END_HOUR
    en = headers.get("X-Runner-Maint-Enabled")
    if en is not None and en != "":
        MAINT_ENABLED = en not in ("0", "false", "no")
    win = headers.get("X-Runner-Maint-Window", "")
    if win and "-" in win:
        try:
            a, b = win.split("-", 1)
            sh, eh = int(a), int(b)
            if 0 <= sh <= 23 and 0 <= eh <= 23:
                if (sh, eh) != (MAINT_START_HOUR, MAINT_END_HOUR):
                    print(f"⚙ maintenance window changed: {sh:02d}:00–{eh:02d}:00 (enabled={MAINT_ENABLED})")
                MAINT_START_HOUR, MAINT_END_HOUR = sh, eh
        except (TypeError, ValueError):
            pass


def poll():
    """Poll for the next job. Returns (job_or_None, anonymity_flag_or_None)."""
    global BOOT
    try:
        resp = request("GET", "/api/runner/job")
        BOOT = False  # first successful poll delivered the boot signal
        _apply_workers(resp.headers)
        _apply_maint_schedule(resp.headers)
        anon = resp.headers.get("X-Runner-Anonymity") == "on"
        if resp.status == 204:
            return None, anon
        return json.loads(resp.read().decode()), anon
    except urllib.error.HTTPError as e:
        if e.code == 401:
            # Self-heal in place — re-enroll for a fresh token and skip this poll,
            # instead of exiting. Next poll uses the new token. NEVER die on a 401.
            reenroll_on_401()
            return None, None
        print(f"  poll error: HTTP {e.code}")
        try:
            _apply_workers(e.headers)
            _apply_maint_schedule(e.headers)
            return None, (e.headers.get("X-Runner-Anonymity") == "on")
        except Exception:  # noqa: BLE001
            return None, None
    except Exception as e:  # noqa: BLE001
        print(f"  poll error: {e}")
        return None, None


_HTTPX_BIN = None


def resolve_httpx():
    """Find the ProjectDiscovery httpx, not the Python `httpx` HTTP-client library
    that often shadows it on PATH (it errors with "Usage: httpx [OPTIONS] URL /
    No such option: -t"). We probe candidate locations and accept the first one
    whose `-version` doesn't look like the Python CLI. Cached after first success."""
    global _HTTPX_BIN
    if _HTTPX_BIN and os.path.exists(_HTTPX_BIN):
        return _HTTPX_BIN
    seen = []
    for c in (
        shutil.which("httpx"),
        "/usr/local/bin/httpx",
        os.path.expanduser("~/go/bin/httpx"),
        "/root/go/bin/httpx",
    ):
        if not c or c in seen or not os.path.exists(c):
            continue
        seen.append(c)
        try:
            r = subprocess.run([c, "-version"], capture_output=True, text=True, timeout=10)
            out = (r.stdout + r.stderr).lower()
        except Exception:  # noqa: BLE001
            continue
        # The Python httpx library CLI prints this usage / click error; skip it.
        if "no such option" in out or "[options] url" in out:
            continue
        _HTTPX_BIN = c
        return c
    return None


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

    bin_ = spec["bin"]
    if job["tool"] == "httpx":
        # Disambiguate ProjectDiscovery httpx from the Python httpx library.
        hx = resolve_httpx()
        if not hx:
            return None, (
                "ProjectDiscovery httpx isn't installed (the Python 'httpx' library may be "
                "shadowing it). Install httpx from Machines → Tools (go install), then retry."
            )
        bin_ = hx

    argv = [bin_, *args]
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

    # Authenticated / session-aware scanning: the portal may hand us pre-computed
    # argv tokens (e.g. `-H` + `Cookie: session=…`) so the scan runs as the
    # logged-in user. Each token is appended verbatim as ONE argument — no shell,
    # no re-splitting — so a header value with spaces stays intact and safe.
    extra = job.get("authArgv")
    if isinstance(extra, list):
        for tok in extra:
            if safe_header_token(tok):
                argv.append(tok)

    return argv, None


def post_progress(job_id, output):
    """Best-effort push of partial output for a still-running job (live verbose)."""
    try:
        request("POST", f"/api/runner/job/{job_id}/progress", {"output": output}, timeout=10)
    except Exception:  # noqa: BLE001 — progress is best-effort
        pass


def run_savefile(job):
    """Write a generated exploit/script to a file (from the Exploit Lab). The
    content is base64 in `args`; the path is `target`. Refuses non-absolute or
    traversal paths."""
    path = job.get("target", "")
    if not path.startswith("/") or ".." in path:
        return "Refused: path must be absolute and contain no '..'.", 1
    try:
        content = base64.b64decode(job.get("args", "")).decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return f"Could not decode content: {e}", 1
    try:
        parent = os.path.dirname(path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        try:
            os.chmod(path, 0o755)
        except Exception:  # noqa: BLE001
            pass
        return f"Saved {len(content)} bytes to {path}", 0
    except Exception as e:  # noqa: BLE001
        return f"Write failed: {e}", 1


def run_wifisense(job):
    """Real WiFi sensing sample. Reads the connected access point's signal (RSSI)
    on the given interface over a short window. People moving in the space perturb
    the multipath, so RSSI variance → motion/presence. Managed mode, no special
    hardware — works on whatever Wi-Fi the machine is associated on. Emits JSON:
    {iface, ssid, bssid, rate, samples:[{t, rssi, q}]}."""
    iface = (job.get("target") or "").strip()
    if not re.match(r"^[a-zA-Z0-9_.\-]{1,32}$", iface):
        return "Refused: bad interface name.", 1
    try:
        seconds = int(float((job.get("args") or "20").split()[0]))
    except Exception:  # noqa: BLE001
        seconds = 20
    seconds = max(4, min(40, seconds))
    rate = 10  # samples/sec

    ssid = bssid = ""
    try:
        if shutil.which("iw"):
            link = subprocess.run(
                ["iw", "dev", iface, "link"], capture_output=True, text=True, timeout=5
            ).stdout
            mb = re.search(r"Connected to ([0-9a-fA-F:]{17})", link)
            bssid = mb.group(1) if mb else ""
            ms = re.search(r"SSID:\s*(.+)", link)
            ssid = ms.group(1).strip() if ms else ""
    except Exception:  # noqa: BLE001
        pass

    def read_rssi():
        # /proc/net/wireless row: "wlan0: 0000   70.  -41.  -256  ..."
        try:
            with open("/proc/net/wireless") as f:
                for line in f:
                    if line.strip().startswith(iface + ":"):
                        parts = line.replace(":", " ").split()
                        return float(parts[3].rstrip(".")), float(parts[2].rstrip("."))
        except Exception:  # noqa: BLE001
            pass
        return None, None

    lvl0, _ = read_rssi()
    if lvl0 is None:
        return (
            json.dumps({
                "iface": iface,
                "error": "no-wireless",
                "message": f"{iface} has no active wireless link — not associated, not a Wi-Fi adapter, or a VM without Wi-Fi passthrough.",
            }),
            0,
        )

    samples = []
    t0 = time.time()
    for _ in range(seconds * rate):
        lvl, link = read_rssi()
        if lvl is not None:
            samples.append({"t": round(time.time() - t0, 2), "rssi": round(lvl), "q": round(link)})
        time.sleep(1.0 / rate)
    return (json.dumps({"iface": iface, "ssid": ssid, "bssid": bssid, "rate": rate, "samples": samples}), 0)


def _default_route_iface() -> str:
    """The interface carrying the default route — the one we must NOT knock into
    monitor mode (that would cut the runner's own connectivity)."""
    try:
        out = subprocess.run(["ip", "route", "show", "default"], capture_output=True, text=True, timeout=5).stdout
        m = re.search(r"\bdev\s+(\S+)", out)
        return m.group(1) if m else ""
    except Exception:  # noqa: BLE001
        return ""


def _monitor_ifaces() -> list[str]:
    """Interfaces currently in monitor mode."""
    mons = []
    try:
        out = subprocess.run(["iw", "dev"], capture_output=True, text=True, timeout=5).stdout
        cur = ""
        for line in out.splitlines():
            m = re.search(r"Interface\s+(\S+)", line)
            if m:
                cur = m.group(1)
            elif "type monitor" in line and cur:
                mons.append(cur)
    except Exception:  # noqa: BLE001
        pass
    return mons


def _restore_managed(mon: str, iface: str, sh) -> None:
    """Bring a monitor-mode adapter back to managed mode and re-trigger
    NetworkManager autoconnect. Idempotent + best-effort, and ALWAYS called from a
    finally, so a monitor-mode job can never leave the runner stuck offline. `sh`
    is the caller's sudo-aware subprocess runner."""
    try:
        sh(["airmon-ng", "stop", mon], timeout=20)
    except Exception:  # noqa: BLE001
        pass
    # If airmon-ng didn't take it out of monitor, force it via iw (both the mon
    # iface and the original name, which may differ, e.g. wlan0 → wlan0mon).
    if mon in _monitor_ifaces() or iface in _monitor_ifaces():
        for tgt in {mon, iface}:
            sh(["ip", "link", "set", tgt, "down"])
            sh(["iw", "dev", tgt, "set", "type", "managed"])
            sh(["ip", "link", "set", tgt, "up"])
    # Hand the interface back to NetworkManager and reconnect known networks so the
    # runner's own uplink comes straight back.
    sh(["nmcli", "dev", "set", iface, "managed", "yes"])
    if shutil.which("systemctl"):
        sh(["systemctl", "restart", "NetworkManager"], timeout=20)
    sh(["nmcli", "networking", "on"])
    print(f"  ↺ restored {iface} to managed mode")


def run_wifisurvey(job):
    """Monitor-mode RF survey — the real "wherever signal reaches" map source.

    Puts a monitor-capable adapter (e.g. TL-WN721N / AR9271) into monitor mode,
    lets airodump-ng channel-hop across the band, and captures EVERY access point
    and client station it hears with real per-device RSSI, channel, encryption,
    vendor OUI (resolved portal-side) and packet counts. One capture is one
    "vantage"; the portal fuses several vantages (a short walk) into real 2D
    positions + a coverage footprint.

    Emits JSON: {iface, mon, vantage, durationSec, aps:[...], stations:[...]}.
    Authorized spaces only. Never touches the interface carrying the default
    route, and restores managed mode on any adapter it switched."""
    iface = (job.get("target") or "").strip()
    if not re.match(r"^[a-zA-Z0-9_.\-]{1,32}$", iface):
        return "Refused: bad interface name.", 1
    args = (job.get("args") or "").split()
    seconds = 25
    vantage = ""
    for a in args:
        if a.isdigit():
            seconds = int(a)
        elif a.startswith("vantage="):
            vantage = a[len("vantage="):][:40]
    seconds = max(8, min(90, seconds))

    if iface == _default_route_iface():
        return (json.dumps({
            "iface": iface, "error": "default-route",
            "message": f"{iface} carries this machine's internet route — refusing to put it in monitor mode (it would cut connectivity). Pick your dedicated adapter (the TL-WN721N), not the one the runner reaches the portal through.",
        }), 0)

    if not shutil.which("airodump-ng"):
        return (json.dumps({
            "iface": iface, "error": "no-airodump",
            "message": "airodump-ng not installed. On Kali: sudo apt-get install -y aircrack-ng.",
        }), 0)

    sudo, stdin_in = _sudo_prefix()

    def sh(argv, timeout=20):
        try:
            return subprocess.run(sudo + argv, input=stdin_in, capture_output=True,
                                  text=True, timeout=timeout)
        except Exception:  # noqa: BLE001
            return None

    # Resolve a monitor interface. Prefer one already in monitor mode; else switch
    # the requested adapter and remember to restore it.
    mons = _monitor_ifaces()
    mon = iface if iface in mons else (mons[0] if mons else "")
    we_enabled = False
    if not mon:
        # Try airmon-ng first (handles NetworkManager); fall back to plain iw.
        started = sh(["airmon-ng", "start", iface], timeout=25)
        after = _monitor_ifaces()
        # airmon-ng may create "<iface>mon" / "wlanXmon" or flip the iface in place.
        new = [m for m in after if m not in mons]
        if new:
            mon = new[0]
        elif iface in after:
            mon = iface
        else:
            sh(["ip", "link", "set", iface, "down"])
            sh(["iw", "dev", iface, "set", "type", "monitor"])
            sh(["ip", "link", "set", iface, "up"])
            mon = iface if iface in _monitor_ifaces() else ""
        we_enabled = bool(mon)
        if not mon:
            return (json.dumps({
                "iface": iface, "error": "no-monitor",
                "message": f"Could not put {iface} into monitor mode. Confirm it's a monitor-capable adapter (TL-WN721N is), that it's passed through to this VM, and that the runner has sudo.",
                "detail": (started.stderr if started else "")[:400],
            }), 0)

    # From here the adapter is in monitor mode. GUARANTEE we put it back (finally),
    # so a crash/timeout anywhere in the capture or parse can never leave the
    # runner stuck in monitor mode and offline.
    try:
        csv_prefix = "/tmp/rdsurvey"
        try:
            for f in os.listdir("/tmp"):
                if f.startswith("rdsurvey-"):
                    try:
                        os.remove(os.path.join("/tmp", f))
                    except Exception:  # noqa: BLE001
                        pass
        except Exception:  # noqa: BLE001
            pass

        # airodump-ng hops channels on its own; --write-interval flushes the CSV so
        # a timeout kill still leaves a readable file.
        proc = subprocess.Popen(
            sudo + ["airodump-ng", "-w", csv_prefix, "--output-format", "csv",
                    "--write-interval", "1", mon],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        try:
            if stdin_in and proc.stdin:
                try:
                    proc.stdin.write(stdin_in.encode())
                    proc.stdin.flush()
                except Exception:  # noqa: BLE001
                    pass
            time.sleep(seconds)
        finally:
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except Exception:  # noqa: BLE001
                try:
                    proc.kill()
                except Exception:  # noqa: BLE001
                    pass

        csv_text = ""
        try:
            for f in sorted(os.listdir("/tmp")):
                if f.startswith("rdsurvey-") and f.endswith(".csv"):
                    with open(os.path.join("/tmp", f), errors="ignore") as fh:
                        csv_text = fh.read()
        except Exception:  # noqa: BLE001
            pass

        aps, stations = _parse_airodump_csv(csv_text)
        return (json.dumps({
            "iface": iface, "mon": mon, "vantage": vantage,
            "durationSec": seconds, "aps": aps, "stations": stations,
        }), 0)
    finally:
        # ALWAYS restore managed mode + reconnect if we switched the adapter.
        if we_enabled and mon:
            _restore_managed(mon, iface, sh)


def _parse_airodump_csv(text: str):
    """Parse an airodump-ng CSV into (aps, stations). Two sections separated by a
    blank line; power is RSSI in dBm."""
    aps, stations = [], []
    if not text.strip():
        return aps, stations
    lines = text.splitlines()
    section = 0  # 0 = none, 1 = APs, 2 = stations
    for raw in lines:
        line = raw.strip()
        low = line.lower()
        if low.startswith("bssid,") and "essid" in low:
            section = 1
            continue
        if low.startswith("station mac"):
            section = 2
            continue
        if not line:
            continue
        cols = [c.strip() for c in line.split(",")]
        if section == 1 and len(cols) >= 14 and re.match(r"^[0-9A-Fa-f:]{17}$", cols[0]):
            try:
                power = int(cols[8])
            except Exception:  # noqa: BLE001
                power = 0
            aps.append({
                "bssid": cols[0].upper(),
                "channel": _int_or(cols[3]),
                "privacy": cols[5],
                "cipher": cols[6],
                "auth": cols[7],
                "power": power,
                "beacons": _int_or(cols[9]),
                "essid": cols[13] if len(cols) > 13 else "",
                "firstSeen": cols[1],
                "lastSeen": cols[2],
            })
        elif section == 2 and len(cols) >= 6 and re.match(r"^[0-9A-Fa-f:]{17}$", cols[0]):
            try:
                power = int(cols[3])
            except Exception:  # noqa: BLE001
                power = 0
            stations.append({
                "mac": cols[0].upper(),
                "power": power,
                "packets": _int_or(cols[4]),
                "bssid": cols[5].upper() if re.match(r"^[0-9A-Fa-f:]{17}$", cols[5]) else "",
                "probes": ",".join(cols[6:]).strip() if len(cols) > 6 else "",
                "firstSeen": cols[1],
                "lastSeen": cols[2],
            })
    return aps, stations


def _int_or(s, default=0):
    try:
        return int(str(s).strip())
    except Exception:  # noqa: BLE001
        return default


# Track running job processes so cancellations from the portal can kill them and
# free the worker slot (otherwise a canceled job keeps running and blocks new ones).
RUNNING_PROCS: dict = {}
PROCS_LOCK = threading.Lock()
CANCELED_IDS: set = set()


def check_cancellations():
    """Kill any running job the portal has marked canceled. Best-effort; this must
    never raise — both the heartbeat and the main loop call it."""
    try:
        with PROCS_LOCK:
            if not RUNNING_PROCS:
                return
        resp = request("GET", "/api/runner/job/canceled", timeout=10)
        ids = json.loads(resp.read().decode()).get("ids", [])
        with PROCS_LOCK:
            for jid in ids:
                proc = RUNNING_PROCS.get(jid)
                if proc is not None:
                    CANCELED_IDS.add(jid)
                    try:
                        proc.kill()
                        print(f"  ✖ job {jid} canceled from portal — killed")
                    except Exception:  # noqa: BLE001
                        pass
    except Exception:  # noqa: BLE001 — cancellation checks never crash a loop
        return


def ensure_installed(tool):
    """Auto-install a missing allowlisted tool via apt so a job doesn't fail just
    because the binary isn't present yet. Best-effort, never raises; returns a
    short note prepended to the job output ('' when there's nothing to do)."""
    try:
        spec = TOOLS.get(tool, {})
        bin_name = spec.get("bin") or EXTRA_INSTALL_BINS.get(tool) or tool
        if shutil.which(bin_name):
            return ""
        pkg = spec.get("pkg") or INSTALL_PKGS.get(tool)
        go_source = GO_INSTALL.get(tool)
        # Go-based tools (httpx, katana, naabu, dalfox…) have no apt package — the
        # apt path below can't help them, so self-heal via `go install` when the
        # runner has sudo. This is why httpx "always failed": it was never being
        # auto-installed, unlike the apt tools.
        if not pkg and go_source:
            sudo, stdin_in = _sudo_prefix()
            env = {**os.environ, "DEBIAN_FRONTEND": "noninteractive"}
            print(f"  ⬇ '{tool}' not installed — auto-installing via go install…")
            _go_install(tool, go_source, sudo, stdin_in, env, f"auto-{tool}")
            # httpx needs the PD-specific resolver (the Python httpx lib shadows it).
            ok = bool(resolve_httpx()) if tool == "httpx" else bool(shutil.which(bin_name))
            if ok:
                return f"[runner] auto-installed missing tool '{tool}' (go install).\n\n"
            return f"[runner] could not auto-install '{tool}' — install it from the Machines page.\n\n"
        if not pkg or not shutil.which("apt-get"):
            return ""  # go-only handled above, or non-Debian — leave to manual install
        sudo, stdin_in = _sudo_prefix()
        env = {**os.environ, "DEBIAN_FRONTEND": "noninteractive"}
        print(f"  ⬇ '{tool}' not installed — auto-installing ({pkg})…")
        subprocess.run(
            sudo + ["apt-get", "install", "-y", pkg],
            input=stdin_in, env=env, capture_output=True, text=True, timeout=INSTALL_TIMEOUT,
        )
        if shutil.which(bin_name):
            return f"[runner] auto-installed missing tool '{tool}'.\n\n"
        # apt failed but a Go source exists (e.g. nuclei/ffuf) — try go install too.
        if go_source:
            _go_install(tool, go_source, sudo, stdin_in, env, f"auto-{tool}")
            if shutil.which(bin_name):
                return f"[runner] auto-installed missing tool '{tool}' (go install).\n\n"
        return f"[runner] could not auto-install '{tool}' — install it from the Machines page.\n\n"
    except Exception:  # noqa: BLE001 — auto-install is best-effort
        return ""


# Directory/content wordlists gobuster/ffuf/dirsearch/feroxbuster need. gobuster
# in particular has NO built-in list and dies instantly with "wordlist file does
# not exist" when its -w path is missing — the #1 cause of gobuster "failing".
WORDLIST_CANDIDATES = [
    "/usr/share/wordlists/dirb/common.txt",
    "/usr/share/seclists/Discovery/Web-Content/common.txt",
    "/usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt",
    "/usr/share/seclists/Discovery/Web-Content/directory-list-2.3-medium.txt",
    "/usr/share/wordlists/dirb/big.txt",
    "/usr/share/wordlists/dirbuster/directory-list-2.3-small.txt",
]

# A compact, always-available fallback list written to disk when no system
# wordlist exists (and apt can't fetch one). Covers the high-signal paths.
_FALLBACK_WORDS = """admin administrator login logout signin signup register
dashboard api api/v1 api/v2 graphql swagger swagger-ui openapi docs redoc
.git .git/config .env .env.local .env.production config config.php config.json
config.yml config.yaml settings settings.py wp-admin wp-login.php wp-config.php
wp-content wp-json xmlrpc.php phpinfo.php phpmyadmin adminer server-status
backup backups backup.zip backup.sql backup.tar.gz db.sql dump.sql database.sql
old old.zip test test.php dev staging debug console actuator actuator/health
actuator/env metrics status health info robots.txt sitemap.xml .htaccess
.htpasswd .DS_Store .svn .svn/entries crossdomain.xml clientaccesspolicy.xml
upload uploads files file download downloads assets static media images img
js css includes inc lib vendor node_modules tmp temp cache logs log error.log
access.log user users account accounts profile settings admin.php index.php
home main portal secure private internal cgi-bin .well-known/security.txt""".split()


def _write_fallback_wordlist() -> str:
    """Write the built-in wordlist to a stable path and return it."""
    d = os.path.expanduser("~/.rdaisec")
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, "wordlist-common.txt")
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(dict.fromkeys(_FALLBACK_WORDS)) + "\n")
    return path


def resolve_wordlist(argv):
    """If argv passes `-w <path>` (or --wordlist) to a dir-buster and that path is
    missing, swap in an existing system wordlist — trying apt once, then falling
    back to a built-in list. Guarantees gobuster/ffuf/etc. always get a real
    wordlist instead of instantly failing. Returns a note ('' if nothing changed)."""
    try:
        idx = -1
        for i, tok in enumerate(argv):
            if tok in ("-w", "--wordlist") and i + 1 < len(argv):
                idx = i + 1
                break
        # feroxbuster/gobuster accept -w; if none given, only add one for tools
        # that REQUIRE it (gobuster). Detect gobuster by argv[0] basename.
        base = os.path.basename(argv[0]) if argv else ""
        wanted = argv[idx] if idx >= 0 else None
        if wanted and os.path.exists(wanted):
            return ""  # given wordlist exists — nothing to do
        if idx < 0 and base != "gobuster":
            return ""  # no -w and tool doesn't strictly need one
        # Find an existing system wordlist.
        chosen = next((p for p in WORDLIST_CANDIDATES if os.path.exists(p)), None)
        note = ""
        if not chosen:
            # Try to fetch one via apt (best-effort, we have sudo).
            if shutil.which("apt-get"):
                try:
                    sudo, stdin_in = _sudo_prefix()
                    env = {**os.environ, "DEBIAN_FRONTEND": "noninteractive"}
                    subprocess.run(sudo + ["apt-get", "install", "-y", "dirb", "seclists"],
                                   input=stdin_in, env=env, capture_output=True, text=True, timeout=INSTALL_TIMEOUT)
                except Exception:  # noqa: BLE001
                    pass
                chosen = next((p for p in WORDLIST_CANDIDATES if os.path.exists(p)), None)
        if not chosen:
            chosen = _write_fallback_wordlist()
            note = "[runner] no system wordlist found — using the built-in fallback list.\n\n"
        else:
            note = f"[runner] wordlist not found; using {chosen}.\n\n"
        if idx >= 0:
            argv[idx] = chosen
        else:
            # gobuster with no -w at all: append one.
            argv.extend(["-w", chosen])
        return note
    except Exception:  # noqa: BLE001 — never break a job over wordlist resolution
        return ""


def _idor_fetch(method, url, header, marker):
    """One request for the IDOR replay. Returns a COMPACT result — status, body
    length, and whether the owner-data marker appears — so account A's actual data
    never leaves the machine. Never raises."""
    body = b""
    status = 0
    try:
        req = urllib.request.Request(url, method=(method or "GET").upper())
        if header and ":" in header:
            name, _, val = header.partition(":")
            name = name.strip()
            val = val.strip()
            if name and val:
                req.add_header(name, val)
        req.add_header("User-Agent", "rdaisec-idor")
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read(300000)  # cap the read; we only need length + marker
            status = resp.getcode()
    except urllib.error.HTTPError as e:
        status = e.code
        try:
            body = e.read(300000)
        except Exception:  # noqa: BLE001
            body = b""
    except Exception:  # noqa: BLE001
        return {"s": 0, "n": 0, "m": False}
    text = body.decode("utf-8", "ignore") if body else ""
    return {"s": int(status), "n": len(body), "m": bool(marker) and marker in text}


def run_idor(job):
    """Two-account IDOR/BOLA replay. For each endpoint, request it as account A
    (owner), account B (attacker), and anonymously, and report only status/length/
    marker-present per identity. The portal decides the verdict (lib/idor-core)."""
    spec = job.get("idorSpec") or {}
    endpoints = spec.get("endpoints") or []
    header_a = spec.get("headerA") or ""
    header_b = spec.get("headerB") or ""
    marker = (spec.get("marker") or "").strip()
    if not endpoints or not header_a or not header_b:
        return "IDOR replay skipped: missing endpoints or one of the two account sessions.", 1
    probes = []
    for ep in endpoints[:60]:  # bound the replay (3 requests each)
        if not isinstance(ep, dict):
            continue
        method = str(ep.get("method") or "GET")
        url = str(ep.get("url") or "")
        if not url.lower().startswith(("http://", "https://")):
            continue
        probes.append({
            "ep": f"{method.upper()} {url}",
            "o": _idor_fetch(method, url, header_a, marker),
            "a": _idor_fetch(method, url, header_b, marker),
            "x": _idor_fetch(method, url, "", marker),
        })
    return json.dumps({"probes": probes}), 0


def run_job(job):
    if job.get("tool") == "savefile":
        return run_savefile(job)
    if job.get("tool") == "wifisense":
        return run_wifisense(job)
    if job.get("tool") == "wifisurvey":
        return run_wifisurvey(job)
    if job.get("tool") == "idorprobe" or job.get("idorSpec"):
        return run_idor(job)
    argv, err = build_argv(job)
    if err:
        return err, 1
    # Auto-install a missing allowlisted tool so the job doesn't just fail 127.
    install_note = "" if job.get("tool") == "custom" else ensure_installed(job.get("tool", ""))
    # Make sure any dir-buster has a wordlist that actually exists (gobuster dies
    # instantly otherwise). Also covers ffuf/dirsearch/feroxbuster and custom cmds.
    if any(t in ("-w", "--wordlist") for t in argv) or (argv and os.path.basename(argv[0]) == "gobuster"):
        install_note += resolve_wordlist(argv)
    # Anonymize TCP-connect traffic through Tor when enabled.
    if ANON_ON and shutil.which("torsocks"):
        argv = ["torsocks", *argv]
    print(f"  $ {' '.join(redact_argv(argv))}")
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
        return install_note + f"'{argv[0]}' is not installed on this runner.", 127

    # Register so a portal cancellation can find & kill this process (and so the
    # local status page can show what's running).
    with PROCS_LOCK:
        RUNNING_PROCS[job_id] = proc
        RUNNING_JOBS[job_id] = {"tool": job.get("tool", ""), "target": job.get("target", ""), "at": time.time()}

    # Watchdog kills the process if it runs past the (per-tool) timeout.
    killed = {"v": False}
    to = job_timeout(job.get("tool", ""))
    # Password cracking (aircrack-ng / hashcat) needs much longer than a normal job.
    _a = job.get("args") or ""
    if ("aircrack-ng" in _a and "-w" in _a) or "hashcat" in _a:
        to = 2400

    def _kill():
        killed["v"] = True
        # Graceful first: SIGTERM lets scanners (nuclei, sqlmap, nmap) flush the
        # partial results they've found so far; SIGKILL only if it won't exit.
        try:
            proc.terminate()
            try:
                proc.wait(timeout=10)
                return
            except Exception:  # noqa: BLE001 — still running, force it
                pass
            proc.kill()
        except Exception:  # noqa: BLE001
            pass

    timer = threading.Timer(to, _kill)
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
        with PROCS_LOCK:
            RUNNING_PROCS.pop(job_id, None)
            RUNNING_JOBS.pop(job_id, None)

    out = (install_note + "".join(buf))[:MAX_OUTPUT]
    with PROCS_LOCK:
        was_canceled = job_id in CANCELED_IDS
        CANCELED_IDS.discard(job_id)
    if was_canceled:
        return out + "\n\nJob canceled from the portal.", 130
    if killed["v"]:
        return out + f"\n\nJob timed out after {to}s and was stopped.", 124
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
            reenroll_on_401()  # self-heal, don't die
            return None
        return None
    except Exception:  # noqa: BLE001
        return None


def post_install_progress(inst_id, output):
    """Best-effort push of partial install output (live verbose)."""
    try:
        request("POST", f"/api/runner/install/{inst_id}/progress", {"output": output}, timeout=10)
    except Exception:  # noqa: BLE001
        pass


def _stream_install_cmd(argv, stdin_in, env, timeout, inst_id, buf, state):
    """Run one install command, streaming its output into buf and posting partial
    progress. Returns the exit code (124 on timeout)."""
    proc = subprocess.Popen(
        argv,
        stdin=subprocess.PIPE if stdin_in else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=env,
    )
    killed = {"v": False}

    def _kill():
        killed["v"] = True
        # Graceful first: SIGTERM lets scanners (nuclei, sqlmap, nmap) flush the
        # partial results they've found so far; SIGKILL only if it won't exit.
        try:
            proc.terminate()
            try:
                proc.wait(timeout=10)
                return
            except Exception:  # noqa: BLE001 — still running, force it
                pass
            proc.kill()
        except Exception:  # noqa: BLE001
            pass

    timer = threading.Timer(timeout, _kill)
    timer.start()
    try:
        if stdin_in and proc.stdin:
            try:
                proc.stdin.write(stdin_in)
                proc.stdin.close()
            except Exception:  # noqa: BLE001
                pass
        for line in proc.stdout:  # type: ignore[union-attr]
            if state["size"] < MAX_OUTPUT:
                buf.append(line)
                state["size"] += len(line)
            if PROGRESS_SECONDS > 0:
                now = time.monotonic()
                if now - state["last"] >= PROGRESS_SECONDS:
                    post_install_progress(inst_id, "".join(buf)[:MAX_OUTPUT])
                    state["last"] = now
        proc.wait()
    finally:
        timer.cancel()
    if killed["v"]:
        buf.append(f"\n…timed out after {timeout}s\n")
        return 124
    return proc.returncode if proc.returncode is not None else 0


def _sudo_prefix():
    """Privilege escalation, in order of preference. Returns (argv_prefix, stdin):
      - running as root                  -> no sudo
      - RUNNER_SUDO_PASS set (LOCAL env) -> sudo -S (password piped from here)
      - otherwise                        -> sudo -n (fails if a password is needed)
    The password lives ONLY in this machine's env — it is never sent to the portal."""
    pw = os.environ.get("RUNNER_SUDO_PASS")
    if os.geteuid() == 0:
        return [], None
    if pw:
        return ["sudo", "-S", "-p", ""], pw + "\n"
    return ["sudo", "-n"], None


def _ensure_go(sudo, stdin_in, env, inst_id, buf, state):
    """Return a path to `go`, installing the golang-go apt package if missing."""
    go = shutil.which("go")
    if go:
        return go
    buf.append("\n$ installing Go toolchain (golang-go) via apt…\n")
    if shutil.which("apt-get"):
        _stream_install_cmd(sudo + ["apt-get", "update"], stdin_in, env, 300, inst_id, buf, state)
        _stream_install_cmd(
            sudo + ["apt-get", "install", "-y", "golang-go"], stdin_in, env, INSTALL_TIMEOUT, inst_id, buf, state
        )
    return shutil.which("go")


def _go_install(tool, source, sudo, stdin_in, env, inst_id):
    """Install a Go-based tool (e.g. httpx) into /usr/local/bin via `go install`,
    bootstrapping the Go toolchain first if needed. Streams output like apt."""
    buf: list[str] = [f"$ go install {source}\n"]
    state = {"size": len(buf[0]), "last": 0.0}
    go = _ensure_go(sudo, stdin_in, env, inst_id, buf, state)
    if not go:
        return "".join(buf) + "\nGo toolchain isn't installed and apt couldn't install it.", 1
    # Pass the Go env via the `env` command (AFTER sudo) so the vars survive sudo's
    # environment reset. GOBIN puts the binary on the shared PATH.
    goenv = [
        "env",
        "GOBIN=/usr/local/bin",
        "GOPATH=/root/go",
        "GOCACHE=/root/.cache/go-build",
        "HOME=/root",
        "GOFLAGS=-mod=mod",
        "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    ]
    code = _stream_install_cmd(
        sudo + goenv + [go, "install", "-v", source], stdin_in, env, INSTALL_TIMEOUT, inst_id, buf, state
    )
    text = "".join(buf)
    if code == 0:
        text += f"\n✓ installed {tool} → /usr/local/bin\n"
    else:
        text += "\nGo install failed. The runner needs network access and root (run as root or set RUNNER_SUDO_PASS).\n"
    return text[:MAX_OUTPUT], code


def run_install(inst):
    tool = inst["tool"]
    # The runner uses its OWN recipe keyed by tool id — it never runs a command or
    # source string sent by the portal. The portal only names an allowlisted tool.
    go_source = GO_INSTALL.get(tool)
    sudo, stdin_in = _sudo_prefix()
    env = {**os.environ, "DEBIAN_FRONTEND": "noninteractive"}
    inst_id = inst["id"]

    # Package name resolution for apt, most authoritative first:
    #   1. pkg sent with the install request (server-driven — always current)
    #   2. pkg from the fetched tool spec
    #   3. the built-in fallback map
    spec = TOOLS.get(tool, {})
    pkg = inst.get("pkg") or spec.get("pkg") or INSTALL_PKGS.get(tool)

    # Tools with no apt package (e.g. httpx) install via `go install`.
    if go_source and (inst.get("method") == "go" or not pkg):
        return _go_install(tool, go_source, sudo, stdin_in, env, inst_id)

    if not pkg:
        # No apt package, but a Go source may exist (shouldn't reach here for
        # those — the branch above handles them — but stay safe).
        if go_source:
            return _go_install(tool, go_source, sudo, stdin_in, env, inst_id)
        return f"'{tool}' isn't installable from here — install it manually.", 1
    if not shutil.which("apt-get"):
        # Not a Debian/Kali box — fall back to `go install` if we can.
        if go_source:
            return _go_install(tool, go_source, sudo, stdin_in, env, inst_id)
        return "apt-get not found — this runner isn't a Debian/Kali system.", 127

    buf: list[str] = [f"$ apt-get install {pkg}\n"]
    state = {"size": len(buf[0]), "last": 0.0}
    code = 0
    try:
        _stream_install_cmd(sudo + ["apt-get", "update"], stdin_in, env, 300, inst_id, buf, state)
        code = _stream_install_cmd(
            sudo + ["apt-get", "install", "-y", pkg], stdin_in, env, INSTALL_TIMEOUT, inst_id, buf, state
        )
    except FileNotFoundError:
        if go_source:
            return _go_install(tool, go_source, sudo, stdin_in, env, inst_id)
        return "apt-get not found — this runner isn't a Debian/Kali system.", 127

    text = "".join(buf)
    low = text.lower()

    # apt couldn't find/install the package, but we have a Go source → try it.
    bin_name = spec.get("bin") or EXTRA_INSTALL_BINS.get(tool) or tool
    if code != 0 and go_source and shutil.which(bin_name) is None:
        note = f"\n— apt install failed (exit {code}); falling back to `go install` for {tool} —\n"
        post_install_progress(inst_id, (text + note)[:MAX_OUTPUT])
        gtext, gcode = _go_install(tool, go_source, sudo, stdin_in, env, inst_id)
        return (text + note + gtext)[:MAX_OUTPUT], gcode

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


# ── Self-enrollment (token self-heal) ────────────────────────────────────────
def machine_fingerprint() -> str:
    """A stable, non-reversible id for this machine so a re-enroll reclaims the
    SAME runner row (rotate token in place) instead of spawning a duplicate."""
    for path in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
        try:
            with open(path) as f:
                mid = f.read().strip()
            if mid:
                return hashlib.sha256(("rdaisec:" + mid).encode()).hexdigest()[:32]
        except Exception:  # noqa: BLE001
            pass
    return hashlib.sha256(("rdaisec:" + socket.gethostname()).encode()).hexdigest()[:32]


def _persist_token(token: str) -> None:
    """Save the enrolled token to the config file so restarts skip enrollment.
    Merges with any existing keys; 0600 so it's owner-readable only."""
    try:
        os.makedirs(os.path.dirname(TOKEN_STORE), exist_ok=True)
        kv = {}
        if os.path.exists(TOKEN_STORE):
            with open(TOKEN_STORE) as f:
                for ln in f:
                    s = ln.strip()
                    if s and not s.startswith("#") and "=" in s:
                        k, _, v = s.partition("=")
                        kv[k.strip()] = v
        kv["RUNNER_TOKEN"] = token
        if PORTAL_URL:
            kv.setdefault("PORTAL_URL", PORTAL_URL)
        with open(TOKEN_STORE, "w") as f:
            for k, v in kv.items():
                f.write(f"{k}={v}\n")
        os.chmod(TOKEN_STORE, 0o600)
    except Exception as e:  # noqa: BLE001
        print(f"  (couldn't persist token to {TOKEN_STORE}: {e})")


def enroll() -> bool:
    """Exchange the enrollment code for a fresh runner token, set it live and
    persist it. Returns True on success. Never raises."""
    global RUNNER_TOKEN
    if not ENROLL_CODE or not PORTAL_URL:
        return False
    payload = json.dumps({
        "code": ENROLL_CODE,
        "name": socket.gethostname(),
        "fingerprint": machine_fingerprint(),
    }).encode()
    req = urllib.request.Request(f"{PORTAL_URL}/api/runner/enroll", data=payload, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode())
        tok = data.get("token")
        if tok:
            RUNNER_TOKEN = tok
            _persist_token(tok)
            print(f"✓ Enrolled with the portal — got a runner token (…{tok[-4:]}) and saved it.")
            return True
        print("✗ Enrollment returned no token.")
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = json.loads(e.read().decode()).get("error", "")
        except Exception:  # noqa: BLE001
            pass
        print(f"✗ Enrollment failed (HTTP {e.code}){': ' + detail if detail else ''}.")
    except Exception as e:  # noqa: BLE001
        print(f"✗ Enrollment couldn't reach the portal: {e}")
    return False


# Runtime self-healing: how often we may re-enroll after a mid-run 401. Rate-limited
# so a persistent 401 (or two instances rotating a shared token) can't hammer the
# enroll endpoint; long enough to absorb a token rotation, short enough to recover fast.
REENROLL_MIN_INTERVAL = int(os.environ.get("REENROLL_MIN_INTERVAL", "20"))
_LAST_REENROLL = 0.0


def reenroll_on_401() -> bool:
    """A runtime request was rejected with HTTP 401. Self-heal IN PLACE: fetch a
    fresh token via the enrollment code and KEEP RUNNING, instead of exiting. This
    is what makes a mid-run token rotation (token rotated/wiped, or a second
    instance re-enrolling the same machine) recoverable with no human. Rate-limited.
    Returns True if a fresh token was obtained."""
    global _LAST_REENROLL
    now = time.time()
    if now - _LAST_REENROLL < REENROLL_MIN_INTERVAL:
        return False
    _LAST_REENROLL = now
    if not (ENROLL_CODE and PORTAL_URL):
        note("token rejected (401) and no enrollment code is set — cannot self-heal. "
             "Set RUNNER_ENROLL_CODE (portal → Runners) so this machine can re-enroll.", err=True)
        return False
    note("token rejected (401) — re-enrolling for a fresh token…")
    ok = enroll()
    if ok:
        note("re-enrolled successfully; resuming with the fresh token.")
    return ok


def preflight(_allow_reenroll: bool = True) -> bool:
    """Test portal connectivity once at startup and print a plain diagnosis. Never
    raises. Returns True if the portal answered."""
    try:
        resp = request("GET", "/api/runner/ping", timeout=15)
        code = getattr(resp, "status", 200)
        print(f"✓ Connected to the portal (HTTP {code}). This machine should now show ONLINE on the Machines page.")
        return True
    except urllib.error.HTTPError as e:
        if e.code == 401:
            # Token rejected — if we have an enrollment code, self-heal: fetch a
            # fresh token and re-check once. This is the whole point of enrollment.
            if _allow_reenroll and ENROLL_CODE:
                print("• Token rejected (401) — re-enrolling with the portal…")
                if enroll():
                    return preflight(_allow_reenroll=False)
            print("✗ The portal REJECTED this runner's token (HTTP 401).")
            print("  → RUNNER_TOKEN doesn't match a machine on the portal. Recreate the machine")
            print("    on the Machines page and copy the new token, or set RUNNER_ENROLL_CODE")
            print("    (portal → Runners → enrollment code) so it can self-enroll.")
        else:
            print(f"✗ The portal is reachable but returned HTTP {e.code}. It may be waking up — retrying shortly.")
        return False
    except Exception as e:  # noqa: BLE001
        print(f"✗ Cannot reach the portal at {PORTAL_URL}")
        print(f"  reason: {e}")
        print("  Check, in order:")
        print("    1. PORTAL_URL is exactly your portal address (https://…), no trailing slash.")
        print("    2. This machine has internet:  curl -sS https://1.1.1.1  (should not hang)")
        print("    3. Nothing (VM NAT / proxy / firewall) blocks outbound HTTPS to the portal.")
        print("    Direct test (shows the real HTTP status):")
        print('      curl -sS -m 15 -H "Authorization: Bearer $RUNNER_TOKEN" "$PORTAL_URL/api/runner/ping" -w "\\nHTTP %{http_code}\\n"')
        return False


def ensure_tool_path():
    """Put the standard tool directories on PATH even when we're launched with a
    minimal environment (systemd / cron give a stripped PATH). Without this,
    Go-installed tools in ~/go/bin and things in /usr/local/bin can't be found —
    so they'd show 'uninstalled' and their jobs would fail with 127. Also sets
    GOPATH so `go install` (auto-install) lands somewhere on PATH. Idempotent."""
    home = os.path.expanduser("~")
    gopath = os.environ.get("GOPATH") or os.path.join(home, "go")
    os.environ["GOPATH"] = gopath
    wanted = [
        "/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin",
        os.path.join(gopath, "bin"), os.path.join(home, ".local", "bin"), "/snap/bin",
    ]
    cur = [p for p in os.environ.get("PATH", "").split(os.pathsep) if p]
    for d in wanted:
        if d and d not in cur:
            cur.append(d)
    os.environ["PATH"] = os.pathsep.join(cur)


# ── Local status dashboard server ────────────────────────────────────────────
def _status_snapshot() -> dict:
    """Everything the local dashboard shows, read from live runner state."""
    now = time.time()
    with _STATUS_LOCK:
        connected = _STATUS["connected"] and (now - _STATUS["last_ok"] < 90)
        last_ok = _STATUS["last_ok"]
        last_error = _STATUS["last_error"]
        log = list(_LOG_RING)[-60:]
    with PROCS_LOCK:
        jobs = [dict(v) for v in RUNNING_JOBS.values()]
    return {
        "version": RUNNER_VERSION,
        "portal": PORTAL_URL,
        "connected": connected,
        "pingFails": PING_FAILS,
        "lastOkAgo": int(now - last_ok) if last_ok else None,
        "lastError": last_error,
        "uptimeSec": int(now - _STARTED_AT),
        "activeWorkers": ACTIVE_WORKERS,
        "maxWorkers": MAX_WORKERS,
        "jobs": jobs,
        "wifi": list(WIFI_IFACES),
        "wifiDetail": list(WIFI_DETAIL),
        "maint": MAINT,
        "log": log,
    }


_STATUS_PAGE = """<!doctype html><html><head><meta charset=utf-8>
<title>RD-AISEC runner</title><meta name=viewport content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:dark}body{margin:0;background:#0b0f16;color:#e5e9f0;font:14px/1.5 system-ui,sans-serif}
.wrap{max-width:820px;margin:0 auto;padding:18px}
h1{font-size:18px;margin:0 0 2px}.sub{color:#7c89a8;font-size:12px;margin-bottom:16px}
.card{background:#111826;border:1px solid #1e2a3d;border-radius:12px;padding:14px;margin-bottom:12px}
.row{display:flex;flex-wrap:wrap;gap:10px}.row>.card{flex:1;min-width:150px;margin:0}
.big{font-size:22px;font-weight:700}.mut{color:#7c89a8;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:middle}
.on{background:#34d399}.off{background:#f87171}
.pill{display:inline-block;border:1px solid #1e2a3d;border-radius:999px;padding:1px 8px;font-size:12px;margin:2px 4px 2px 0}
pre{background:#080c13;border:1px solid #1e2a3d;border-radius:8px;padding:10px;max-height:280px;overflow:auto;font:12px/1.5 ui-monospace,monospace;color:#a9b5d1;white-space:pre-wrap}
button{background:#1d64f2;color:#fff;border:0;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer}
.err{color:#fca5a5}
</style></head><body><div class=wrap>
<h1>RD-AISEC runner</h1><div class=sub id=portal></div>
<div class=row>
 <div class=card><div class=mut>Status</div><div class=big id=state>…</div><div class=mut id=lastok></div></div>
 <div class=card><div class=mut>Jobs running</div><div class=big id=jobs>–</div><div class=mut id=workers></div></div>
 <div class=card><div class=mut>Uptime</div><div class=big id=uptime>–</div><div class=mut>v<span id=ver></span></div></div>
</div>
<div class=card><div class=mut>Wi-Fi interfaces</div><div id=wifi>–</div></div>
<div class=card id=errcard style=display:none><div class=mut>Last error</div><div class=err id=err></div></div>
<div class=card><div style=display:flex;justify-content:space-between;align-items:center>
 <div class=mut>Recent activity</div><button onclick=reconnect()>Reconnect now</button></div>
 <pre id=log></pre></div>
<div class=sub>Auto-refreshes every 2s · served locally on this machine only</div>
</div><script>
function fmtDur(s){if(s==null)return '–';var d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);
return d?d+'d '+h+'h':h?h+'h '+m+'m':m?m+'m':s+'s'}
async function tick(){try{var r=await fetch('/api/status');var s=await r.json();
document.getElementById('portal').textContent=s.portal||'(portal not set)';
var st=document.getElementById('state');st.innerHTML='<span class="dot '+(s.connected?'on':'off')+'"></span>'+(s.connected?'Online':'Offline');
document.getElementById('lastok').textContent=s.connected?'last check '+fmtDur(s.lastOkAgo)+' ago':(s.pingFails+' failed ping(s)');
document.getElementById('jobs').textContent=s.jobs.length;
document.getElementById('workers').textContent=s.activeWorkers+' / '+s.maxWorkers+' workers';
document.getElementById('uptime').textContent=fmtDur(s.uptimeSec);document.getElementById('ver').textContent=s.version;
document.getElementById('wifi').innerHTML=(s.wifi&&s.wifi.length)?s.wifi.map(function(w){return '<span class=pill>'+w+'</span>'}).join(''):'<span class=mut>none detected</span>';
var ec=document.getElementById('errcard');if(s.lastError){ec.style.display='';document.getElementById('err').textContent=s.lastError}else ec.style.display='none';
var jl=s.jobs.map(function(j){return '▸ '+j.tool+'  '+(j.target||'')}).join('\\n');
document.getElementById('log').textContent=(jl?jl+'\\n\\n':'')+(s.log||[]).join('\\n');
}catch(e){document.getElementById('state').textContent='status server…'}}
async function reconnect(){try{await fetch('/reconnect',{method:'POST'})}catch(e){}tick()}
tick();setInterval(tick,2000);
</script></body></html>"""


class _StatusHandler(http.server.BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="text/html; charset=utf-8"):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except Exception:  # noqa: BLE001
            pass

    def do_GET(self):
        if self.path.startswith("/api/status"):
            self._send(200, json.dumps(_status_snapshot()), "application/json")
        elif self.path == "/" or self.path.startswith("/?"):
            self._send(200, _STATUS_PAGE)
        else:
            self._send(404, "not found")

    def do_POST(self):
        if self.path.startswith("/reconnect"):
            WAKE.set()
            note("reconnect requested from local dashboard")
            self._send(200, json.dumps({"ok": True}), "application/json")
        else:
            self._send(404, "not found")

    def log_message(self, *a):  # silence default request logging
        return


def local_status_server():
    """Serve the local status dashboard on 127.0.0.1 (loopback only). Never
    crashes the runner — if the port is taken it just logs and gives up."""
    if not STATUS_ENABLED:
        return
    try:
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", STATUS_PORT), _StatusHandler)
    except Exception as exc:  # noqa: BLE001
        note(f"local status page disabled: {exc}")
        return
    note(f"local status page: http://127.0.0.1:{STATUS_PORT}")
    try:
        httpd.serve_forever(poll_interval=1.0)
    except Exception:  # noqa: BLE001
        pass


_SINGLE_INSTANCE_SOCK = None


def acquire_single_instance() -> bool:
    """Guarantee ONE runner per machine. Two instances (e.g. a GUI-spawned runner
    AND a systemd/curl-installed one) would each enroll the same machine and rotate
    each other's token, producing an endless stream of 401 'token rejected'. A Linux
    abstract-namespace socket is the lock: it's cross-user, needs no lock file, and
    is released automatically when the holder exits. Opt out with RDAISEC_ALLOW_MULTI=1."""
    global _SINGLE_INSTANCE_SOCK
    if os.environ.get("RDAISEC_ALLOW_MULTI") in ("1", "true", "yes"):
        return True
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        s.bind("\0rdaisec-runner")  # abstract namespace (leading NUL) — no fs entry
        _SINGLE_INSTANCE_SOCK = s   # keep a reference so it stays bound for our lifetime
        return True
    except OSError:
        return False
    except Exception:  # noqa: BLE001 — non-Linux / unexpected: don't block startup
        return True


def _release_single_instance() -> None:
    """Drop the single-instance lock. Called right before a self-update / restart
    re-exec so the replacement process can re-acquire it without racing its own
    inherited socket. (Python sets close-on-exec by default, but be explicit.)"""
    global _SINGLE_INSTANCE_SOCK
    try:
        if _SINGLE_INSTANCE_SOCK is not None:
            _SINGLE_INSTANCE_SOCK.close()
            _SINGLE_INSTANCE_SOCK = None
    except Exception:  # noqa: BLE001
        pass


def main():
    global TOOLS, SUBNETS, ACTIVE_WORKERS, WIFI_IFACES, WIFI_MONITOR
    # Single-instance guard FIRST — before we enroll or touch the token — so a
    # second instance can't start a token-rotation war with the first (the #1 cause
    # of persistent "token rejected").
    if not acquire_single_instance():
        sys.exit("Another RD-AISEC runner is already running on this machine. Stop it "
                 "first (e.g. `sudo systemctl stop rdaisec-runner`, or quit the desktop "
                 "app) — running two rotates the token and causes constant 401s. "
                 "Set RDAISEC_ALLOW_MULTI=1 to override (not recommended).")
    # No token yet but we have an enrollment code → self-register for one. This is
    # how a fresh machine comes online without a token ever being hand-pasted.
    if PORTAL_URL and not RUNNER_TOKEN and ENROLL_CODE:
        print("No runner token yet — enrolling with the portal…")
        enroll()
    if not PORTAL_URL or not RUNNER_TOKEN:
        if PORTAL_URL and ENROLL_CODE:
            sys.exit("Enrollment produced no token. Check the enrollment code on the "
                     "portal (Runners) — it may be expired, revoked, or at its use limit.")
        sys.exit("Set PORTAL_URL and RUNNER_TOKEN (or RUNNER_ENROLL_CODE) first.")
    # Repair PATH before anything probes for tools, so a service/cron launch finds
    # the same tools an interactive shell would.
    ensure_tool_path()
    # Enforce TLS: refuse to send the token/jobs/output over plaintext HTTP so a
    # misconfigured PORTAL_URL can never silently downgrade to cleartext. (All
    # traffic already rides inside HTTPS, which urllib verifies by default;
    # localhost http is allowed for local development only.)
    if PORTAL_URL.startswith("http://") and not re.search(r"^http://(localhost|127\.0\.0\.1)\b", PORTAL_URL):
        sys.exit(
            "✗ Refusing to run: PORTAL_URL uses plain HTTP. Use https:// so the "
            "runner↔portal channel is encrypted (localhost is allowed for testing)."
        )
    print(f"RD-AISEC runner → {PORTAL_URL}")

    # Preflight: one clear connectivity check so a wrong URL/token or a blocked
    # network is obvious immediately, instead of the machine silently sitting
    # "offline". This also stamps lastSeenAt, so a healthy runner shows online at
    # once.
    preflight()

    # Pull the latest runner before doing anything else; if newer this re-execs.
    self_update()

    SUBNETS = detect_subnets()
    if SUBNETS:
        print(f"Local network(s): {', '.join(SUBNETS)}")

    WIFI_IFACES, WIFI_MONITOR = detect_wifi()
    if WIFI_IFACES:
        print(f"WiFi: {', '.join(WIFI_IFACES)} (monitor mode: {'yes' if WIFI_MONITOR else 'no'})")

    fetched = fetch_tools()
    if fetched:
        TOOLS = fetched
        print(f"Tools available (from portal): {', '.join(sorted(TOOLS))}")
    else:
        print(f"Tools available (built-in defaults): {', '.join(sorted(TOOLS))}")
    print("Polling for jobs… (Ctrl-C to stop)\n")

    print("Anonymity (Tor) is controlled from the portal → Machines.\n")

    # Prime the telemetry snapshot once (so the first heartbeat already carries
    # stats), then keep it fresh on a background thread — request() reads the
    # snapshot instead of gathering stats inline, so nothing on the request path
    # can block the heartbeat.
    try:
        _sample_stats()
    except Exception:  # noqa: BLE001
        pass
    threading.Thread(target=stats_loop, daemon=True).start()

    # Start the heartbeat so we stay online during long jobs/installs. Keep the
    # handle so the watchdog in the main loop can revive it if it ever dies.
    hb = threading.Thread(target=heartbeat_loop, daemon=True)
    hb.start()

    # Live command stream (SSE): instant job wake-ups + connection-based presence.
    # Pure accelerator — if it can't connect, the poll + heartbeat above carry on.
    threading.Thread(target=stream_loop, daemon=True).start()
    # Reap idle interactive control sessions so a closed browser tab can't leave a
    # shell running on the machine.
    threading.Thread(target=control_reaper, daemon=True).start()

    # Keep nuclei templates current (startup + daily) so scans actually match.
    threading.Thread(target=nuclei_template_loop, daemon=True).start()
    threading.Thread(target=threat_intel_loop, daemon=True).start()
    # Daily self-heal / maintenance cycle (reports a live stage to the portal).
    threading.Thread(target=maintenance_loop, daemon=True).start()
    # Periodic housekeeping — clear stale temp + tool caches between passes.
    threading.Thread(target=cleanup_loop, daemon=True).start()
    # Connection guardian — keep the runner reachable in the hardest situations.
    threading.Thread(target=connection_guardian, daemon=True).start()
    # Local status dashboard — see health/errors on the machine itself (loopback).
    threading.Thread(target=local_status_server, daemon=True).start()

    print(f"Concurrency: up to {MAX_WORKERS} job(s) at once (portal-controlled).\n")

    last_refresh = time.monotonic()
    # Self-update is checked whenever the runner is idle (throttled). Seed the
    # timer now since startup already did one check above.
    last_update_check = time.monotonic()
    while True:
        # The whole pass is guarded: a transient error (a slow/cold portal DB
        # under a big queue, an install/self-update hiccup, a thread spawn issue)
        # must NEVER kill the main loop — that's what made the runner "stop" once
        # the queue grew. Log it and keep polling. Worker slots are freed in the
        # worker's own `finally`, and the heartbeat runs on its own thread.
        try:
            # Watchdog: revive the heartbeat if it ever died, so the machine can't
            # silently go offline (e.g. during a long job, when it's the only pinger).
            if not hb.is_alive():
                hb = threading.Thread(target=heartbeat_loop, daemon=True)
                hb.start()
                print("⤿ heartbeat thread revived")

            # Refresh the allowlist periodically so new portal tools appear here.
            if time.monotonic() - last_refresh > TOOL_REFRESH_SECONDS:
                f = fetch_tools()
                if f:
                    TOOLS = f
                last_refresh = time.monotonic()

            # Free worker slots from any portal-canceled jobs before claiming more.
            check_cancellations()

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

            # Idle this pass. Only handle installs/self-update when nothing is running.
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
                # While genuinely idle, apply a newer runner promptly (throttled).
                if AUTO_UPDATE and time.monotonic() - last_update_check > UPDATE_CHECK_SECONDS:
                    last_update_check = time.monotonic()
                    maybe_self_update()  # re-execs if a newer version is available

            # Wait up to POLL_SECONDS, but wake IMMEDIATELY if the live stream
            # pushed a "wake" (queued work) — instant job pickup when streaming,
            # graceful POLL_SECONDS fallback when it isn't.
            WAKE.wait(POLL_SECONDS)
            WAKE.clear()
        except Exception as e:  # noqa: BLE001 — the main loop must NEVER die
            print(f"  main loop error (continuing): {e}")
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        if _tor_proc is not None:
            _tor_proc.terminate()
