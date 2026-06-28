"""Shiva MCP scanner — static + live security analysis of MCP servers.

Part of the Shiva project's open-source funnel (Scanner · Gateway · Attack
Range). The scanner reads an MCP server's tools and descriptions and reports
the security issues the Attack Range demonstrates: tool poisoning, over-broad
permissions, dangerous capability combinations, and description drift.
"""
from __future__ import annotations

__version__ = "0.1.0"

from .models import (  # noqa: E402
    Finding,
    ScanReport,
    ScanTarget,
    Severity,
    Tool,
    ToolParam,
)

__all__ = [
    "__version__",
    "Finding",
    "ScanReport",
    "ScanTarget",
    "Severity",
    "Tool",
    "ToolParam",
]
