"""
Cryptographic posture capability (crypto.tls_audit) — Runner v2.

Turns TLS scan data into real "weak crypto" findings (OWASP A02: Cryptographic
Failures): deprecated protocols, broken/weak ciphers, missing forward secrecy,
weak keys and certificate signatures, and the named crypto vulns that follow from
them. Pure analysis + an sslscan parser, so it's fully testable offline; the
capability wires it to a live sslscan run.

This is Phase-1 of the crypto direction: detect and report weak crypto (very
achievable, high impact). Breaking sound crypto is out of scope — the bugs live
in weak configuration and misuse, which is exactly what this finds.
"""
from __future__ import annotations

import re
import shutil
import subprocess
from typing import Any, Dict, List

from capabilities import Registry  # type: ignore

# ── Protocol posture ─────────────────────────────────────────────────────────
# name -> (severity, why). Modern baseline is TLS 1.2+ with only TLS 1.3 ideal.
PROTOCOL_RISK = {
    "SSLv2": ("critical", "SSLv2 is fundamentally broken (DROWN) and must be disabled."),
    "SSLv3": ("high", "SSLv3 is broken (POODLE); disable it."),
    "TLSv1.0": ("medium", "TLS 1.0 is deprecated (BEAST/weak); disable it."),
    "TLSv1.1": ("medium", "TLS 1.1 is deprecated; disable it."),
}


def cipher_weakness(name: str) -> tuple[str, str] | None:
    """Return (severity, reason) if a cipher suite is weak, else None."""
    n = name.upper()
    if "NULL" in n:
        return ("critical", "NULL cipher — no encryption at all.")
    if "ANON" in n or re.search(r"(^|[-_])A(ECDH|DH)([-_]|$)", n):
        return ("critical", "Anonymous key exchange — no authentication, trivially MITM'd.")
    if "EXPORT" in n or "EXP" in n.split("_"):
        return ("high", "EXPORT-grade cipher — intentionally weak keys (FREAK/Logjam).")
    if "RC4" in n:
        return ("high", "RC4 is broken (biased keystream); remove it.")
    if "DES-CBC3" in n or "3DES" in n or "DES_EDE" in n:
        return ("medium", "3DES is weak (SWEET32, 64-bit block); remove it.")
    if re.search(r"\bDES\b", n) and "3DES" not in n and "EDE" not in n:
        return ("high", "Single DES — 56-bit key, breakable.")
    if n.endswith("MD5") or "_MD5" in n:
        return ("medium", "MD5 MAC — broken hash; prefer SHA-2 suites.")
    return None


def has_forward_secrecy(ciphers: List[str]) -> bool:
    return any(("ECDHE" in c.upper() or c.upper().startswith("DHE") or "_DHE_" in c.upper()) for c in ciphers)


def _finding(title: str, severity: str, evidence: str, rec: str) -> Dict[str, Any]:
    return {
        "title": title,
        "severity": severity,
        "category": "crypto",
        "owasp": "A02",
        "evidence": evidence,
        "recommendation": rec,
    }


def analyze(protocols: List[str], ciphers: List[str], cert: Dict[str, Any] | None = None,
            host: str = "") -> Dict[str, Any]:
    """Judge a TLS posture → findings. `protocols` = enabled protocol names,
    `ciphers` = accepted cipher-suite names, `cert` = {keyBits, sigAlgo, selfSigned}."""
    findings: List[Dict[str, Any]] = []
    where = f" on {host}" if host else ""

    for p in protocols:
        risk = PROTOCOL_RISK.get(p.replace(" ", ""))
        if risk:
            findings.append(_finding(f"Deprecated TLS protocol {p} enabled{where}",
                                     risk[0], f"{p} is offered by the server.", risk[1]))

    seen = set()
    for c in ciphers:
        w = cipher_weakness(c)
        if w:
            key = (w[0], w[1])
            if key in seen:
                continue
            seen.add(key)
            findings.append(_finding(f"Weak cipher accepted{where}: {c}", w[0],
                                     f"Cipher suite {c} is negotiable.", w[1]))

    if ciphers and not has_forward_secrecy(ciphers):
        findings.append(_finding(f"No forward secrecy{where}", "medium",
                                 "No ECDHE/DHE cipher suites offered.",
                                 "Enable ECDHE suites so past traffic stays safe if the key leaks."))

    if cert:
        kb = cert.get("keyBits")
        if isinstance(kb, int) and kb < 2048:
            findings.append(_finding(f"Weak certificate key ({kb}-bit){where}", "high",
                                     f"Certificate public key is {kb} bits.",
                                     "Reissue with a ≥2048-bit RSA or an ECDSA P-256 key."))
        sig = str(cert.get("sigAlgo", "")).upper()
        if "MD5" in sig:
            findings.append(_finding(f"Certificate signed with MD5{where}", "high",
                                     f"Signature algorithm: {sig}.", "Reissue with SHA-256."))
        elif "SHA1" in sig or "SHA-1" in sig:
            findings.append(_finding(f"Certificate signed with SHA-1{where}", "medium",
                                     f"Signature algorithm: {sig}.", "Reissue with SHA-256."))
        if cert.get("selfSigned"):
            findings.append(_finding(f"Self-signed certificate{where}", "medium",
                                     "Certificate is self-signed.",
                                     "Use a certificate from a trusted CA."))

    worst = _worst_severity([f["severity"] for f in findings])
    return {"findings": findings, "weak": len(findings), "worst": worst}


_SEV_ORDER = ["critical", "high", "medium", "low", "info"]


def _worst_severity(sevs: List[str]) -> str:
    for s in _SEV_ORDER:
        if s in sevs:
            return s
    return "info"


# ── sslscan output parser ────────────────────────────────────────────────────
def parse_sslscan(output: str) -> Dict[str, Any]:
    """Parse sslscan's text output into {protocols, ciphers, cert}."""
    protocols: List[str] = []
    ciphers: List[str] = []
    cert: Dict[str, Any] = {}
    for raw in output.splitlines():
        line = raw.strip()
        m = re.match(r"^(SSLv2|SSLv3|TLSv1\.[0-3])\s+(enabled|disabled)", line, re.I)
        if m and m.group(2).lower() == "enabled":
            protocols.append(m.group(1))
            continue
        # "Accepted  TLSv1.2  256 bits  ECDHE-RSA-AES256-GCM-SHA384"
        m = re.match(r"^(Accepted|Preferred)\s+\S+\s+\d+\s*bits?\s+(\S+)", line, re.I)
        if m:
            ciphers.append(m.group(2))
            continue
        m = re.search(r"RSA Key Strength:\s*(\d+)", line, re.I)
        if m:
            cert["keyBits"] = int(m.group(1))
        m = re.search(r"Signature Algorithm:\s*([A-Za-z0-9\-]+)", line, re.I)
        if m:
            cert["sigAlgo"] = m.group(1)
    return {"protocols": protocols, "ciphers": ciphers, "cert": cert or None}


def register(reg: Registry) -> None:
    @reg.capability(
        name="crypto.tls_audit",
        authorization="active",
        description="Audit a host's TLS crypto posture and emit weak-crypto findings.",
        inputs={"target": "str (host[:port])", "scan": "str? (raw sslscan output to reuse)"},
        outputs={"findings": "list", "weak": "int", "worst": "str"},
    )
    def _tls_audit(ctx, inputs: Dict[str, Any]) -> Dict[str, Any]:
        host = str(inputs.get("target") or "").strip()
        raw = inputs.get("scan")
        if not raw:
            if not shutil.which("sslscan"):
                raise ValueError("sslscan not installed and no prior scan output provided")
            p = subprocess.run(["sslscan", "--no-colour", host], capture_output=True, text=True, timeout=180)
            raw = p.stdout
        parsed = parse_sslscan(str(raw))
        res = analyze(parsed["protocols"], parsed["ciphers"], parsed["cert"], host=host.split(":")[0])
        return res
