#!/usr/bin/env python3
"""
Runner v2 agent — Phase 0.

Ties the task engine to the portal: polls a job, runs it as a task graph on the
new engine (v1 jobs via the drop-in adapter), streams progress, posts the result.
Inherits v1's reliability floor: PATH self-heal, a heartbeat that can't block
(telemetry sampled off the hot path), and single-instance via the systemd unit.

Runs from the runner/agent/ package. Stdlib only in Phase 0.

    PORTAL_URL=https://…  RUNNER_TOKEN=rdr_…  python3 agent.py
"""
from __future__ import annotations

import os
import sys
import threading
import time

# Local package imports (run from inside runner/agent/).
from capabilities import Registry
import modules
import crypto
import web
import wifi
from adapt import job_to_task, result_from_report
from tasks import run_task
from channel import PollChannel

VERSION = "2.0.0-phase0"
PORTAL_URL = os.environ.get("PORTAL_URL", "").strip()
RUNNER_TOKEN = os.environ.get("RUNNER_TOKEN", "").strip()
PING_SECONDS = int(os.environ.get("PING_SECONDS", "15"))
POLL_SECONDS = int(os.environ.get("POLL_SECONDS", "5"))
STATS_SECONDS = int(os.environ.get("STATS_SECONDS", "8"))


# ── PATH self-heal (systemd/cron give a stripped PATH) ───────────────────────
def ensure_tool_path() -> None:
    home = os.path.expanduser("~")
    gopath = os.environ.get("GOPATH") or os.path.join(home, "go")
    os.environ["GOPATH"] = gopath
    wanted = ["/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin",
              os.path.join(gopath, "bin"), os.path.join(home, ".local", "bin"), "/snap/bin"]
    cur = [p for p in os.environ.get("PATH", "").split(os.pathsep) if p]
    for d in wanted:
        if d and d not in cur:
            cur.append(d)
    os.environ["PATH"] = os.pathsep.join(cur)


# ── Telemetry cache (off the request hot path) ───────────────────────────────
class Stats:
    def __init__(self):
        self._d: dict = {}
        self._lock = threading.Lock()
        self._cpu_prev = None

    def _cpu(self):
        try:
            with open("/proc/stat") as f:
                p = [int(x) for x in f.readline().split()[1:]]
            idle, total = p[3] + (p[4] if len(p) > 4 else 0), sum(p)
            prev, self._cpu_prev = self._cpu_prev, (idle, total)
            if not prev or total - prev[1] <= 0:
                return None
            return max(0, min(100, round((1 - (idle - prev[0]) / (total - prev[1])) * 100)))
        except Exception:  # noqa: BLE001
            return None

    def _mem(self):
        try:
            info = {}
            with open("/proc/meminfo") as f:
                for line in f:
                    k, _, v = line.partition(":")
                    info[k] = int(v.strip().split()[0])
            total = info.get("MemTotal", 0)
            avail = info.get("MemAvailable", info.get("MemFree", 0))
            return (round((1 - avail / total) * 100) if total else None,
                    (total - avail) // 1024 if total else None, total // 1024 if total else None)
        except Exception:  # noqa: BLE001
            return (None, None, None)

    def sample(self, installed):
        memp, memu, memt = self._mem()
        d = {"cpu": self._cpu(), "mem": memp, "mem_used": memu, "mem_total": memt,
             "cores": os.cpu_count(), "installed": installed()}
        try:
            st = os.statvfs("/")
            d["disk_used"] = round((st.f_blocks - st.f_bavail) * st.f_frsize / 1048576)
            d["disk_total"] = round(st.f_blocks * st.f_frsize / 1048576)
        except Exception:  # noqa: BLE001
            pass
        try:
            with open("/proc/uptime") as f:
                d["uptime"] = int(float(f.read().split()[0]))
        except Exception:  # noqa: BLE001
            pass
        with self._lock:
            self._d = d

    def snapshot(self):
        with self._lock:
            return dict(self._d)


class Agent:
    def __init__(self):
        if not PORTAL_URL or not RUNNER_TOKEN:
            sys.exit("Set PORTAL_URL and RUNNER_TOKEN first.")
        self.reg = Registry()
        modules.register(self.reg)
        crypto.register(self.reg)
        web.register(self.reg)
        wifi.register(self.reg)
        self.tools: dict = {}
        self.stats = Stats()
        self.boot = True
        self.ping_fails = 0
        self.channel = PollChannel(PORTAL_URL, RUNNER_TOKEN, self._headers)

    # Identity + telemetry headers read from the cache — never blocks.
    def _installed(self):
        import shutil
        return sorted({tid for tid, s in self.tools.items() if shutil.which(s.get("bin", tid))})

    def _headers(self):
        s = self.stats.snapshot()
        h = {
            "X-Runner-Version": VERSION,
            "X-Runner-Tools": ",".join(sorted(self.tools)),
        }
        if self.boot:
            h["X-Runner-Boot"] = "1"
        inst = s.get("installed")
        if inst:
            h["X-Runner-Installed"] = ",".join(inst)
        for hk, k in (("X-Runner-Cpu", "cpu"), ("X-Runner-Mem", "mem"),
                      ("X-Runner-Mem-Used", "mem_used"), ("X-Runner-Mem-Total", "mem_total"),
                      ("X-Runner-Disk-Used", "disk_used"), ("X-Runner-Disk-Total", "disk_total"),
                      ("X-Runner-Cores", "cores"), ("X-Runner-Uptime", "uptime")):
            if s.get(k) is not None:
                h[hk] = str(s[k])
        return h

    def _stats_loop(self):
        while True:
            try:
                self.stats.sample(self._installed)
            except Exception:  # noqa: BLE001
                pass
            time.sleep(STATS_SECONDS)

    def _heartbeat_loop(self):
        beat = 0
        while True:
            try:
                beat += 1
                cmd = self.channel.ping(full=(beat % 5 == 0))
                if self.ping_fails:
                    print(f"✓ portal reachable again — online")
                self.ping_fails = 0
                if cmd == "restart":
                    self._restart()
            except Exception as e:  # noqa: BLE001 — heartbeat never dies
                if self.ping_fails == 0:
                    print(f"✗ can't reach the portal — machine OFFLINE. ({e})")
                self.ping_fails += 1
            time.sleep(PING_SECONDS)

    def _restart(self):
        try:
            os.execv(sys.executable, [sys.executable] + sys.argv)
        except Exception:  # noqa: BLE001
            os._exit(0)

    def _run_job(self, job):
        job_id = job.get("id")
        try:
            task = job_to_task(job, self.tools)
            # Stream step events as progress lines back to the portal.
            def emit(ev):
                if ev.get("status") in ("running", "done", "error", "refused", "skipped"):
                    self.channel.post_progress(job_id, f"[{ev.get('step')}] {ev.get('status')}"
                                               + (f" — {ev['error']}" if ev.get("error") else ""))
            report = run_task(task, self.reg, emit)
            result = result_from_report(report)
        except Exception as e:  # noqa: BLE001
            result = {"output": f"[agent] job failed: {e}", "exitCode": 1, "status": "error"}
        self.channel.post_result(job_id, result)
        print(f"  job {job_id}: {result['status']} (exit {result.get('exitCode')})")

    def run(self):
        print(f"RD-AISEC agent v{VERSION} → {PORTAL_URL}")
        ensure_tool_path()
        # Preflight so a bad URL/token is obvious immediately.
        try:
            self.channel.ping()
            print("✓ Connected to the portal — should show ONLINE.")
        except SystemExit:
            raise
        except Exception as e:  # noqa: BLE001
            print(f"✗ Cannot reach the portal: {e}")
        self.tools = self.channel.fetch_tools()
        self.stats.sample(self._installed)
        print(f"Tools: {len(self.tools)} allowlisted · {len(self._installed())} installed")

        threading.Thread(target=self._stats_loop, daemon=True).start()
        hb = threading.Thread(target=self._heartbeat_loop, daemon=True)
        hb.start()
        print("Polling for jobs… (Ctrl-C to stop)\n")

        last_tools = time.monotonic()
        while True:
            try:
                if not hb.is_alive():
                    hb = threading.Thread(target=self._heartbeat_loop, daemon=True)
                    hb.start()
                if time.monotonic() - last_tools > 300:
                    t = self.channel.fetch_tools()
                    if t:
                        self.tools = t
                    last_tools = time.monotonic()
                job, _control = self.channel.poll_task()
                self.boot = False  # first successful poll delivered the boot signal
                if job:
                    print(f"▶ job {job.get('id')}: {job.get('tool')} {job.get('target','')}")
                    self._run_job(job)
                    continue
                time.sleep(POLL_SECONDS)
            except SystemExit:
                raise
            except Exception as e:  # noqa: BLE001 — the loop must never die
                print(f"  loop error (continuing): {e}")
                time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    try:
        Agent().run()
    except KeyboardInterrupt:
        print("\nStopped.")
