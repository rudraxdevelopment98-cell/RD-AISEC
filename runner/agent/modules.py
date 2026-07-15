"""
Built-in capability modules for Runner v2 (Phase 0).

These give the new agent parity with v1 (run a tool / a custom command) on the
new architecture, plus a passive example. More modules (crypto, exploit, wifi,
pivot…) register the same way — that's how the agent's abilities grow without
core changes.
"""
from __future__ import annotations

import shutil
import socket
import subprocess
from typing import Any, Dict

from capabilities import Registry  # type: ignore


def register(reg: Registry) -> None:
    """Register the built-in capabilities into a registry."""

    @reg.capability(
        name="core.shell",
        authorization="intrusive",
        description="Run a command as argv (no shell) on this machine.",
        inputs={"argv": "list[str]", "timeout": "int?"},
        outputs={"stdout": "str", "exitCode": "int"},
    )
    def _shell(ctx, inputs: Dict[str, Any]) -> Dict[str, Any]:
        argv = inputs.get("argv")
        if isinstance(argv, str):
            argv = argv.split()
        if not argv:
            raise ValueError("core.shell needs argv")
        timeout = int(inputs.get("timeout") or 300)
        p = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
        return {"stdout": p.stdout, "stderr": p.stderr, "exitCode": p.returncode}

    @reg.capability(
        name="core.tool",
        authorization="active",
        description="Run an allowlisted tool binary against a target.",
        inputs={"bin": "str", "args": "list[str]?", "flag": "str?", "target": "str"},
        outputs={"stdout": "str", "exitCode": "int"},
    )
    def _tool(ctx, inputs: Dict[str, Any]) -> Dict[str, Any]:
        bin_ = inputs.get("bin")
        if not bin_ or not shutil.which(bin_):
            raise ValueError(f"tool not found on PATH: {bin_!r}")
        args = inputs.get("args") or []
        if isinstance(args, str):
            args = [a for a in args.split(" ") if a]
        target = str(inputs.get("target") or "")
        flag = inputs.get("flag")
        argv = [bin_, *args]
        if target:
            if flag:
                # URL-based tool (httpx/nuclei/sqlmap…) — keep the full URL after the flag.
                argv += [flag, target]
            else:
                # Host-based tool (nmap/whois/dig…) — strip any scheme/path.
                import re
                host = re.sub(r"^[a-z][a-z0-9+.\-]*://", "", target, flags=re.I).split("/")[0]
                argv.append(host)
        timeout = int(inputs.get("timeout") or 900)
        p = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
        return {"stdout": p.stdout, "stderr": p.stderr, "exitCode": p.returncode, "argv": argv}

    @reg.capability(
        name="recon.resolve",
        authorization="passive",
        description="Resolve a hostname to IP addresses (passive lookup).",
        inputs={"host": "str"},
        outputs={"ips": "list[str]", "count": "int"},
    )
    def _resolve(ctx, inputs: Dict[str, Any]) -> Dict[str, Any]:
        host = str(inputs.get("host") or "").strip()
        try:
            infos = socket.getaddrinfo(host, None)
            ips = sorted({i[4][0] for i in infos})
        except Exception:  # noqa: BLE001
            ips = []
        return {"ips": ips, "count": len(ips)}
