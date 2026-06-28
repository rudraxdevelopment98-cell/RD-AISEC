"""Live input adapter — introspect a running MCP server over the protocol.

This connects to the server as a real MCP client would (stdio transport),
calls `tools/list`, and normalises the result into the same `ScanTarget` the
static adapter produces — so the identical checks run against what the server
*actually* advertises at runtime.

The `mcp` SDK is an optional dependency (see requirements-live.txt). It is
imported lazily so the static path works with zero dependencies.
"""
from __future__ import annotations

import shlex

from .models import ScanTarget, Tool, ToolParam


class LiveScanError(RuntimeError):
    """Raised when a live introspection cannot be completed."""


def from_command(command: str | list[str]) -> ScanTarget:
    """Launch an MCP server via a shell command and list its tools.

    `command` is how you'd start the server, e.g. "python poisoned_server.py".
    """
    argv = shlex.split(command) if isinstance(command, str) else list(command)
    if not argv:
        raise LiveScanError("empty server command")

    try:
        import asyncio
    except ImportError as exc:  # pragma: no cover
        raise LiveScanError("asyncio unavailable") from exc

    return asyncio.run(_introspect(argv))


async def _introspect(argv: list[str]) -> ScanTarget:
    try:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
    except ImportError as exc:
        raise LiveScanError(
            "the MCP SDK is required for --live scans. Install it with:\n"
            "    pip install -r requirements-live.txt   (or: pip install \"mcp[cli]\")"
        ) from exc

    params = StdioServerParameters(command=argv[0], args=argv[1:])
    target = ScanTarget(
        source_kind="live", source_ref=" ".join(argv)
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            target.name = _server_name(init)
            listed = await session.list_tools()
            for t in listed.tools:
                target.tools.append(_tool_from_sdk(t))
    return target


def _server_name(init: object) -> str:
    info = getattr(init, "serverInfo", None)
    if info is not None:
        return str(getattr(info, "name", "") or "")
    return ""


def _tool_from_sdk(t: object) -> Tool:
    name = str(getattr(t, "name", "") or "")
    description = str(getattr(t, "description", "") or "")
    params: list[ToolParam] = []
    schema = getattr(t, "inputSchema", None)
    if isinstance(schema, dict):
        props = schema.get("properties")
        if isinstance(props, dict):
            for pname, pspec in props.items():
                annotation = ""
                if isinstance(pspec, dict):
                    annotation = str(pspec.get("type", ""))
                params.append(ToolParam(name=str(pname), annotation=annotation))
    return Tool(name=name, description=description, params=params,
                description_source="live")
