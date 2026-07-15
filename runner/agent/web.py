"""
Web posture capability (web.security_headers) — Runner v2.

Flags missing/weak HTTP security headers and unsafe cookies — a common,
high-signal finding class (OWASP A05: Security Misconfiguration). Pure analysis +
a header fetcher, so the judgement is fully testable offline.
"""
from __future__ import annotations

import urllib.request
from typing import Any, Dict, List


def _f(title: str, severity: str, evidence: str, rec: str, owasp: str = "A05") -> Dict[str, Any]:
    return {"title": title, "severity": severity, "category": "web-hardening",
            "owasp": owasp, "evidence": evidence, "recommendation": rec}


def analyze_headers(headers: Dict[str, str], url: str = "") -> Dict[str, Any]:
    """Judge a response's security headers. `headers` keys are case-insensitive."""
    h = {k.lower(): v for k, v in headers.items()}
    where = f" on {url}" if url else ""
    findings: List[Dict[str, Any]] = []

    if "strict-transport-security" not in h:
        findings.append(_f(f"Missing HSTS{where}", "medium",
                           "No Strict-Transport-Security header.",
                           "Add Strict-Transport-Security: max-age=31536000; includeSubDomains."))
    if "content-security-policy" not in h:
        findings.append(_f(f"Missing Content-Security-Policy{where}", "medium",
                           "No Content-Security-Policy header.",
                           "Add a CSP to mitigate XSS/injection."))
    if "x-frame-options" not in h and "frame-ancestors" not in h.get("content-security-policy", "").lower():
        findings.append(_f(f"Missing clickjacking protection{where}", "medium",
                           "No X-Frame-Options and no CSP frame-ancestors.",
                           "Add X-Frame-Options: DENY or a CSP frame-ancestors directive."))
    if h.get("x-content-type-options", "").lower() != "nosniff":
        findings.append(_f(f"Missing X-Content-Type-Options: nosniff{where}", "low",
                           "MIME-sniffing not disabled.",
                           "Add X-Content-Type-Options: nosniff."))
    if "referrer-policy" not in h:
        findings.append(_f(f"Missing Referrer-Policy{where}", "low",
                           "No Referrer-Policy header.",
                           "Add Referrer-Policy: strict-origin-when-cross-origin."))

    # Version/tech disclosure.
    for hdr in ("server", "x-powered-by", "x-aspnet-version"):
        val = h.get(hdr, "")
        if val and any(ch.isdigit() for ch in val):
            findings.append(_f(f"Version disclosure via {hdr}{where}", "low",
                               f"{hdr}: {val}", f"Remove or genericise the {hdr} header.", owasp="A05"))

    # Cookie flags.
    setck = headers.get("Set-Cookie") or headers.get("set-cookie") or ""
    if setck:
        low = setck.lower()
        if "secure" not in low:
            findings.append(_f(f"Cookie without Secure flag{where}", "medium",
                               "A Set-Cookie lacks the Secure attribute.",
                               "Set Secure on all cookies so they're TLS-only."))
        if "httponly" not in low:
            findings.append(_f(f"Cookie without HttpOnly flag{where}", "medium",
                               "A Set-Cookie lacks HttpOnly.",
                               "Set HttpOnly so JavaScript can't read session cookies."))

    order = ["critical", "high", "medium", "low", "info"]
    worst = next((s for s in order if any(x["severity"] == s for x in findings)), "info")
    return {"findings": findings, "weak": len(findings), "worst": worst}


def parse_header_block(text: str) -> Dict[str, str]:
    """Parse a raw HTTP header block ('Name: value' lines) into a dict."""
    out: Dict[str, str] = {}
    for line in text.splitlines():
        if ":" in line and not line.startswith("HTTP/"):
            k, _, v = line.partition(":")
            out[k.strip()] = v.strip()
    return out


def register(reg) -> None:
    @reg.capability(
        name="web.security_headers",
        authorization="active",
        description="Fetch a URL and flag missing/weak HTTP security headers.",
        inputs={"url": "str", "headers": "dict? (reuse a prior fetch)"},
        outputs={"findings": "list", "weak": "int"},
    )
    def _sh(ctx, inputs: Dict[str, Any]) -> Dict[str, Any]:
        provided = inputs.get("headers")
        url = str(inputs.get("url") or "")
        if provided:
            headers = provided if isinstance(provided, dict) else parse_header_block(str(provided))
        else:
            req = urllib.request.Request(url, method="GET", headers={"User-Agent": "rdaisec-agent"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                headers = dict(resp.headers.items())
        return analyze_headers(headers, url)
