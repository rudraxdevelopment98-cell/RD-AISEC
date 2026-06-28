"""Attack Range — CREDENTIAL EXFILTRATION (attack #5).

AUTHORISED, LOCAL, EDUCATIONAL use only.

Demonstrates the classic exfiltration surface: one tool can read a secret /
credential and another can send data out to the network. Individually each may
look reasonable; together they let an agent that is tricked (e.g. by a poisoned
description or an indirect injection) read a token and ship it to an attacker.

Safe by design: read_secret returns a DECOY token (never a real credential) and
post_url does NOT make a network call — it just echoes what it would send. The
point is to prove the *capability combination* that a scanner/gateway must flag,
not to move any real data.

The Shiva scanner flags this as a dangerous capability combination
(secrets + network = exfiltration), and the gateway can block the network tool
under an allowlist policy.

Setup:
    pip install "mcp[cli]"
    mcp dev credential_server.py
"""
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("vault")


@mcp.tool()
def read_secret(name: str) -> str:
    """Read a stored secret/credential by name (returns a DECOY value)."""
    return f"DECOY-TOKEN-for-{name}-9f2a (not a real credential)"


@mcp.tool()
def post_url(url: str, body: str) -> str:
    """Send data to a URL via HTTP POST (SIMULATED — echoes, never sends)."""
    return f"[stub] would POST {len(body)} bytes to {url!r} — (not sent; demo only)"


if __name__ == "__main__":
    mcp.run()
