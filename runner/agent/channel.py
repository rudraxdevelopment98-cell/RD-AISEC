"""
Channel — how the agent talks to the portal.

Abstracted on purpose: Phase 0 ships PollChannel (the proven v1 poll/claim/post
over HTTPS), and a BusChannel (persistent realtime pub/sub) drops in later behind
the same interface without touching the agent loop. Stdlib only.
"""
from __future__ import annotations

import json
import urllib.request
import urllib.error
from typing import Any, Callable, Dict, Optional, Tuple


class Channel:
    """Interface the agent uses. Implementations: PollChannel (now), BusChannel."""

    def poll_task(self) -> Tuple[Optional[Dict[str, Any]], Dict[str, str]]:
        raise NotImplementedError

    def post_result(self, job_id: str, result: Dict[str, Any]) -> bool:
        raise NotImplementedError

    def post_progress(self, job_id: str, output: str) -> None:
        raise NotImplementedError

    def post_events(self, job_id: str, events: list) -> None:
        """Append task-graph step events to the realtime bus (best-effort)."""
        raise NotImplementedError

    def ping(self, full: bool = False) -> Optional[str]:
        """Heartbeat. Returns a one-shot command from the portal (e.g. 'restart')."""
        raise NotImplementedError

    def fetch_tools(self) -> Dict[str, Dict[str, Any]]:
        raise NotImplementedError

    def fetch_script(self) -> str:
        raise NotImplementedError


class PollChannel(Channel):
    """v1-compatible HTTPS poll channel. `headers_provider` returns the live
    telemetry/identity headers dict for each request (read from a cache, so it
    never blocks)."""

    def __init__(self, portal_url: str, token: str,
                 headers_provider: Callable[[], Dict[str, str]]):
        self.base = portal_url.rstrip("/")
        self.token = token
        self._headers = headers_provider

    def _request(self, method: str, path: str, body: Any = None, timeout: int = 30):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.token}")
        for k, v in self._headers().items():
            if v is not None and v != "":
                req.add_header(k, str(v))
        if data is not None:
            req.add_header("Content-Type", "application/json")
        return urllib.request.urlopen(req, timeout=timeout)

    def poll_task(self):
        try:
            resp = self._request("GET", "/api/runner/job")
            control = self._control(resp.headers)
            if resp.status == 204:
                return None, control
            return json.loads(resp.read().decode()), control
        except urllib.error.HTTPError as e:
            if e.code == 401:
                raise SystemExit("✗ Runner token rejected. Check RUNNER_TOKEN.")
            return None, self._control(getattr(e, "headers", {}) or {})
        except Exception:  # noqa: BLE001
            return None, {}

    @staticmethod
    def _control(headers) -> Dict[str, str]:
        get = headers.get if hasattr(headers, "get") else (lambda k, d=None: d)
        return {
            "maxWorkers": get("X-Runner-Max-Workers", "") or "",
            "anonymity": get("X-Runner-Anonymity", "") or "",
        }

    def post_result(self, job_id: str, result: Dict[str, Any]) -> bool:
        for attempt in range(4):
            try:
                self._request("POST", f"/api/runner/job/{job_id}/result", result, timeout=60)
                return True
            except Exception:  # noqa: BLE001
                import time
                time.sleep(2 ** attempt)
        return False

    def post_progress(self, job_id: str, output: str) -> None:
        try:
            self._request("POST", f"/api/runner/job/{job_id}/progress", {"output": output}, timeout=10)
        except Exception:  # noqa: BLE001
            pass

    def post_events(self, job_id: str, events: list) -> None:
        # Realtime bus append — best-effort and non-fatal: if the bus is down the
        # job still runs and its final result posts normally via post_result.
        if not events:
            return
        try:
            self._request("POST", f"/api/runner/job/{job_id}/event", {"events": events}, timeout=10)
        except Exception:  # noqa: BLE001
            pass

    def ping(self, full: bool = False) -> Optional[str]:
        path = "/api/runner/ping" + ("?full=1" if full else "")
        resp = self._request("GET", path, timeout=8)
        try:
            return resp.getheader("X-Runner-Command")
        except Exception:  # noqa: BLE001
            return None

    def fetch_tools(self) -> Dict[str, Dict[str, Any]]:
        try:
            resp = self._request("GET", "/api/runner/tools")
            data = json.loads(resp.read().decode())
            out: Dict[str, Dict[str, Any]] = {}
            for t in data.get("tools", []):
                tid, b = t.get("id"), t.get("bin")
                if tid and b:
                    out[tid] = {"bin": b, "flag": t.get("flag"), "pkg": t.get("pkg")}
            return out
        except Exception:  # noqa: BLE001
            return {}

    def fetch_script(self) -> str:
        resp = self._request("GET", "/api/runner/script")
        return resp.read().decode()
