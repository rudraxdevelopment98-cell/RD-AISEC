"""Attack Range — benign baseline MCP server.

Day 2 of Phase 0: the smallest possible MCP server, so you can see the
whole request/response + metadata flow end to end. Nothing malicious here.

Run it in the inspector:
    pip install "mcp[cli]"
    mcp dev benign_server.py
"""
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("demo")


@mcp.tool()
def read_file(path: str) -> str:
    """Read a UTF-8 text file and return its contents."""
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


@mcp.tool()
def get_weather(city: str) -> str:
    """Return a (fake) weather report for a city."""
    return f"It's a clear 24°C in {city}."


if __name__ == "__main__":
    mcp.run()
