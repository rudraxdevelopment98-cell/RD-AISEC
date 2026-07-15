"""
v1 compatibility — turn a legacy `(tool, target, args)` job into a one-step task.

This is what makes Runner v2 a drop-in: the portal keeps sending the same jobs it
sends v1, and the agent runs each as a single-step task graph on the new engine.
When the portal later sends real multi-step task graphs, the same engine runs
them unchanged.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from tasks import TaskGraph


def job_to_task(job: Dict[str, Any], tools: Dict[str, Dict[str, Any]],
                grant: Optional[Dict[str, Any]] = None) -> TaskGraph:
    """Build a task graph for a legacy job. `tools` is the allowlist (id -> spec
    with bin/flag) from /api/runner/tools. `grant` authorizes the target."""
    tool = job.get("tool", "")
    target = job.get("target", "")
    args = job.get("args", "")

    if tool == "custom":
        # Full command line the portal composed — run it as argv (no shell).
        step = {"id": "run", "use": "core.shell", "in": {"argv": str(args)}}
    else:
        spec = tools.get(tool) or {}
        step = {
            "id": "run",
            "use": "core.tool",
            "in": {
                "bin": spec.get("bin", tool),
                "flag": spec.get("flag"),
                "args": args,
                "target": target,
            },
        }

    # Legacy jobs are already authorized by the portal (it only queues jobs for
    # authorized engagements), so they carry the portal-authorized wildcard grant
    # unless the caller passes a narrower one.
    doc: Dict[str, Any] = {
        "task": f"job:{tool}",
        "authorization": grant or {"scope": "*", "grantedBy": "portal"},
        "steps": [step],
    }
    return TaskGraph.parse(doc)


def result_from_report(report: Dict[str, Any]) -> Dict[str, Any]:
    """Collapse a one-step task report back into the v1 result shape
    {output, exitCode, status} the portal expects."""
    run = report.get("run", {})
    status_map = {"done": "done", "error": "error", "refused": "error", "skipped": "error"}
    st = run.get("status", "error")
    if st == "done":
        out = run.get("outputs", {})
        stdout = out.get("stdout", "")
        stderr = out.get("stderr", "")
        body = stdout + (("\n" + stderr) if stderr and out.get("exitCode") else "")
        return {"output": body or stdout, "exitCode": int(out.get("exitCode", 0)), "status": "done"}
    # error / refused / skipped → surface the reason as the output
    reason = run.get("error") or run.get("reason") or "step did not run"
    return {"output": f"[agent] {reason}", "exitCode": 1, "status": status_map.get(st, "error")}
