"""Live stdio MCP proxy — the runtime front-end over the gateway engine.

    client  ⇄  shiva-gateway-proxy  ⇄  upstream MCP server

The proxy is itself an MCP stdio server that a client (Claude Desktop, an agent,
the Inspector) connects to. It spawns the real upstream server, mirrors its
tools, and routes every tools/list and tools/call through the *tested* Gateway
engine: poisoned/drifted/out-of-policy calls are blocked (enforce) or flagged
(monitor); everything else is forwarded to the upstream untouched.

The MCP SDK is an optional dependency (see requirements-live.txt) and is imported
lazily, so the rest of the gateway works without it. This I/O glue is not
unit-tested here (it needs the SDK + a live server); the decision logic it calls
is fully covered by the engine tests.

Run it:
    pip install "mcp[cli]"
    shiva-gateway-proxy "python ../attack-range/poisoned_server.py" --mode enforce
    # then point an MCP client at this process instead of the upstream server.
"""
from __future__ import annotations

import json
import shlex
import sys
from pathlib import Path

from shiva_scanner.models import ScanTarget, Tool, ToolParam

from .engine import Gateway
from .policy import Policy


class ProxyError(RuntimeError):
    """Raised when the live proxy cannot start (e.g. the SDK is missing)."""


def run_stdio_proxy(
    upstream_cmd: str | list[str],
    policy: Policy | None = None,
    baseline: dict[str, str] | None = None,
) -> None:
    """Block, serving the gateway proxy over stdio until the client disconnects."""
    try:
        import anyio
    except ImportError as exc:  # pragma: no cover - anyio ships with mcp
        raise ProxyError('the MCP SDK is required: pip install "mcp[cli]"') from exc
    anyio.run(_serve, upstream_cmd, policy or Policy(), baseline)


async def _serve(
    upstream_cmd: str | list[str], policy: Policy, baseline: dict[str, str] | None
) -> None:
    try:
        from mcp import ClientSession, StdioServerParameters, types
        from mcp.client.stdio import stdio_client
        from mcp.server.lowlevel import Server
        from mcp.server.stdio import stdio_server
    except ImportError as exc:
        raise ProxyError('the MCP SDK is required: pip install "mcp[cli]"') from exc

    argv = shlex.split(upstream_cmd) if isinstance(upstream_cmd, str) else list(upstream_cmd)
    if not argv:
        raise ProxyError("empty upstream command")

    gateway = Gateway(policy=policy, baseline=baseline)
    up_params = StdioServerParameters(command=argv[0], args=argv[1:])

    async with stdio_client(up_params) as (up_read, up_write):
        async with ClientSession(up_read, up_write) as upstream:
            await upstream.initialize()
            server: "Server" = Server("shiva-gateway")

            @server.list_tools()
            async def _list_tools():
                listed = await upstream.list_tools()
                # Re-score on every listing so a description rug-pull is caught live.
                gateway.register_tools(_to_target(listed.tools))
                return listed.tools

            @server.call_tool()
            async def _call_tool(name: str, arguments: dict | None):
                decision = gateway.authorize_call(name, arguments or {})
                _log(f"{decision.action} {name}: {'; '.join(decision.reasons) or 'ok'}")
                if not decision.allowed:
                    reasons = "; ".join(decision.reasons) or "policy violation"
                    return [
                        types.TextContent(
                            type="text",
                            text=f"⛔ Shiva gateway blocked '{name}': {reasons}",
                        )
                    ]
                result = await upstream.call_tool(name, arguments or {})
                return result.content

            options = server.create_initialization_options()
            async with stdio_server() as (read, write):
                await server.run(read, write, options)


def _to_target(sdk_tools) -> ScanTarget:
    """Map SDK tool objects into the scanner/gateway's normalised shape."""
    target = ScanTarget(source_kind="live")
    for t in sdk_tools:
        params: list[ToolParam] = []
        schema = getattr(t, "inputSchema", None)
        if isinstance(schema, dict):
            props = schema.get("properties")
            if isinstance(props, dict):
                for pname, pspec in props.items():
                    ann = str(pspec.get("type", "")) if isinstance(pspec, dict) else ""
                    params.append(ToolParam(name=str(pname), annotation=ann))
        target.tools.append(
            Tool(
                name=str(getattr(t, "name", "") or ""),
                description=str(getattr(t, "description", "") or ""),
                params=params,
            )
        )
    return target


def _log(msg: str) -> None:
    # Live visibility for the operator; never touches the client's stdout stream.
    print(f"[shiva-gateway] {msg}", file=sys.stderr, flush=True)


def _load_baseline(path: str) -> dict[str, str]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    hashes = data.get("hashes", data) if isinstance(data, dict) else {}
    return {str(k): str(v) for k, v in hashes.items()}


def main(argv: list[str] | None = None) -> int:
    import argparse

    p = argparse.ArgumentParser(
        prog="shiva-gateway-proxy",
        description="Live MCP stdio gateway: client ⇄ Shiva ⇄ upstream server.",
    )
    p.add_argument("upstream", help="command to start the upstream MCP server, "
                                    "e.g. 'python server.py'")
    p.add_argument("--mode", choices=["monitor", "enforce"], default="enforce",
                   help="enforce = block violations (default); monitor = flag only")
    p.add_argument("--allow", action="append", metavar="TOOL",
                   help="allowlist: only these tools may be called (repeatable)")
    p.add_argument("--block", action="append", default=[], metavar="TOOL",
                   help="forbid this tool (repeatable)")
    p.add_argument("--baseline", metavar="FILE",
                   help="trusted description baseline (shiva-scan --update-baseline)")
    args = p.parse_args(argv)

    policy = Policy(mode=args.mode, allow_tools=args.allow, block_tools=args.block)
    baseline = _load_baseline(args.baseline) if args.baseline else None
    try:
        run_stdio_proxy(args.upstream, policy, baseline)
    except ProxyError as exc:
        print(f"shiva-gateway-proxy: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:  # pragma: no cover
        return 0
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
