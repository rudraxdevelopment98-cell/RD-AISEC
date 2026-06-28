"""Static input adapters — turn source/manifest files into a `ScanTarget`.

Two entry points:
  * `from_python_source` — AST analysis of a FastMCP server (no code is run).
  * `from_manifest` — a JSON MCP `tools/list` export (or a simple tools array).

Static analysis never executes the target, which is the safe default for CI.
"""
from __future__ import annotations

import ast
import json
from pathlib import Path

from .models import ScanTarget, Tool, ToolParam


def load(path: str | Path) -> ScanTarget:
    """Dispatch on file type: .json -> manifest, otherwise Python source."""
    p = Path(path)
    if p.suffix.lower() == ".json":
        return from_manifest(p)
    return from_python_source(p)


# --------------------------------------------------------------------------- #
# Python (FastMCP) source                                                     #
# --------------------------------------------------------------------------- #

def from_python_source(path: str | Path) -> ScanTarget:
    p = Path(path)
    tree = ast.parse(p.read_text(encoding="utf-8"), filename=str(p))

    mcp_vars = _find_mcp_vars(tree)
    server_name = _find_server_name(tree, mcp_vars)

    target = ScanTarget(name=server_name, source_kind="static", source_ref=str(p))
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            tool = _tool_from_function(node, mcp_vars, p.name)
            if tool is not None:
                target.tools.append(tool)
    return target


def _find_mcp_vars(tree: ast.Module) -> set[str]:
    """Names assigned `FastMCP(...)` — the server objects whose .tool we trust."""
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
            if _call_func_name(node.value) in {"FastMCP", "Server", "FastMCPServer"}:
                for tgt in node.targets:
                    if isinstance(tgt, ast.Name):
                        names.add(tgt.id)
    return names or {"mcp"}  # fall back to the conventional name


def _find_server_name(tree: ast.Module, mcp_vars: set[str]) -> str:
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
            if _call_func_name(node.value) in {"FastMCP", "Server", "FastMCPServer"}:
                if node.value.args and isinstance(node.value.args[0], ast.Constant):
                    val = node.value.args[0].value
                    if isinstance(val, str):
                        return val
    return ""


def _tool_from_function(
    fn: ast.FunctionDef | ast.AsyncFunctionDef, mcp_vars: set[str], filename: str
) -> Tool | None:
    """Build a Tool if `fn` is decorated with `@<mcp>.tool(...)`."""
    deco = _tool_decorator(fn, mcp_vars)
    if deco is None:
        return None

    name = fn.name
    description = ast.get_docstring(fn) or ""
    description_dynamic = False
    description_source = "docstring"

    # A `@mcp.tool(name=..., description=...)` call can override both.
    if isinstance(deco, ast.Call):
        for kw in deco.keywords:
            if kw.arg == "name" and isinstance(kw.value, ast.Constant):
                if isinstance(kw.value.value, str):
                    name = kw.value.value
            elif kw.arg == "description":
                if isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                    description = kw.value.value
                    description_source = "decorator description= (literal)"
                else:
                    # Non-literal: the description is computed at runtime → drift risk.
                    description_dynamic = True
                    description = ""
                    description_source = (
                        f"decorator description= ({_unparse(kw.value)})"
                    )

    params = _params_from_function(fn)
    location = f"{filename}:{fn.lineno}"
    return Tool(
        name=name,
        description=description,
        params=params,
        description_dynamic=description_dynamic,
        description_source=description_source,
        location=location,
    )


def _tool_decorator(
    fn: ast.FunctionDef | ast.AsyncFunctionDef, mcp_vars: set[str]
) -> ast.expr | None:
    """Return the `.tool` decorator node (Call or Attribute) if present."""
    for dec in fn.decorator_list:
        target = dec.func if isinstance(dec, ast.Call) else dec
        if (
            isinstance(target, ast.Attribute)
            and target.attr in {"tool", "add_tool"}
            and isinstance(target.value, ast.Name)
            and target.value.id in mcp_vars
        ):
            return dec
    return None


def _params_from_function(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> list[ToolParam]:
    params: list[ToolParam] = []
    args = fn.args
    positional = list(args.posonlyargs) + list(args.args)
    for a in positional:
        if a.arg in {"self", "cls", "ctx", "context"}:
            continue
        params.append(ToolParam(name=a.arg, annotation=_unparse(a.annotation)))
    for a in args.kwonlyargs:
        params.append(ToolParam(name=a.arg, annotation=_unparse(a.annotation)))
    return params


def _call_func_name(call: ast.Call) -> str:
    if isinstance(call.func, ast.Name):
        return call.func.id
    if isinstance(call.func, ast.Attribute):
        return call.func.attr
    return ""


def _unparse(node: ast.AST | None) -> str:
    if node is None:
        return ""
    try:
        return ast.unparse(node)
    except Exception:  # pragma: no cover - very old runtimes
        return type(node).__name__


# --------------------------------------------------------------------------- #
# JSON manifest (MCP tools/list export)                                        #
# --------------------------------------------------------------------------- #

def from_manifest(path: str | Path) -> ScanTarget:
    p = Path(path)
    data = json.loads(p.read_text(encoding="utf-8"))
    return parse_manifest(data, source_ref=str(p))


def parse_manifest(data: object, source_ref: str = "") -> ScanTarget:
    """Accepts {"tools":[...]}, a bare [...] array, or {"result":{"tools":[...]}}."""
    server_name = ""
    tools_raw: list = []
    if isinstance(data, dict):
        server_name = str(data.get("name") or data.get("server") or "")
        if isinstance(data.get("tools"), list):
            tools_raw = data["tools"]
        elif isinstance(data.get("result"), dict) and isinstance(
            data["result"].get("tools"), list
        ):
            tools_raw = data["result"]["tools"]
    elif isinstance(data, list):
        tools_raw = data

    target = ScanTarget(name=server_name, source_kind="manifest", source_ref=source_ref)
    for entry in tools_raw:
        if isinstance(entry, dict):
            target.tools.append(_tool_from_manifest_entry(entry))
    return target


def _tool_from_manifest_entry(entry: dict) -> Tool:
    name = str(entry.get("name", ""))
    description = str(entry.get("description", "") or "")
    params: list[ToolParam] = []
    schema = entry.get("inputSchema") or entry.get("input_schema") or {}
    if isinstance(schema, dict):
        props = schema.get("properties")
        if isinstance(props, dict):
            for pname, pspec in props.items():
                annotation = ""
                if isinstance(pspec, dict):
                    annotation = str(pspec.get("type", ""))
                params.append(ToolParam(name=str(pname), annotation=annotation))
    return Tool(name=name, description=description, params=params,
                description_source="manifest")
