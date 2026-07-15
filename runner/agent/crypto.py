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


# ── Hash posture (identify + judge stored-secret hashing) ────────────────────
# Fast, unsalted, or broken hashes are dangerous for password storage: they're
# cheap to brute-force at scale. Modern baseline is a slow KDF (bcrypt/argon2/
# scrypt/PBKDF2). severity is the risk of finding this hash protecting secrets.
_HASH_WEAK = {
    "MD5":      ("high", "MD5 is broken and fast — trivially brute-forced; unusable for passwords."),
    "MD4":      ("high", "MD4 is broken and obsolete."),
    "SHA-1":    ("high", "SHA-1 is broken (collisions) and fast — not for passwords."),
    "NTLM":     ("high", "NTLM is unsalted MD4 — rainbow-tableable; a domain risk."),
    "LM":       ("critical", "LM hash — case-folded, split into 7-char halves; cracks in seconds."),
    "MySQL323": ("critical", "MySQL pre-4.1 hash — 16-bit-ish, cracks instantly."),
    "MySQL-SHA1": ("high", "MySQL 4.1+ is unsalted double-SHA1 — fast, no salt."),
    "SHA-224":  ("medium", "Raw SHA-2 is fast and (here) unsalted — wrong tool for passwords."),
    "SHA-256":  ("medium", "Raw SHA-256 is fast and unsalted — use a slow KDF for passwords."),
    "SHA-384":  ("medium", "Raw SHA-384 is fast and unsalted — use a slow KDF for passwords."),
    "SHA-512":  ("medium", "Raw SHA-512 is fast and unsalted — use a slow KDF for passwords."),
}
# Slow KDFs — the right answer. Presence of these is GOOD (no finding).
_KDF_PREFIX = {
    "$2a$": "bcrypt", "$2b$": "bcrypt", "$2y$": "bcrypt",
    "$argon2i$": "argon2i", "$argon2id$": "argon2id", "$argon2d$": "argon2d",
    "$6$": "sha512crypt", "$5$": "sha256crypt", "$1$": "md5crypt",
    "$scrypt$": "scrypt", "$pbkdf2": "pbkdf2",
}


def identify_hash(digest: str) -> Dict[str, Any]:
    """Best-effort: what is this digest, and is it safe for password storage?
    Returns {candidates: [...], kdf: bool, severity, note}. Length + charset +
    known prefixes — the same heuristics hashid/name-that-hash use, no deps."""
    d = (digest or "").strip()
    for pref, name in _KDF_PREFIX.items():
        if d.startswith(pref):
            return {"candidates": [name], "kdf": True, "severity": "info",
                    "note": f"{name} is a slow, salted KDF — appropriate for passwords."}
    if d.startswith("*") and len(d) == 41 and re.fullmatch(r"\*[0-9A-Fa-f]{40}", d):
        return _hash_result(["MySQL-SHA1"])
    if not re.fullmatch(r"[0-9A-Fa-f]+", d):
        return {"candidates": [], "kdf": False, "severity": "info",
                "note": "Not a recognised hex digest or known KDF format."}
    by_len = {
        16: ["MySQL323"],
        32: ["MD5", "NTLM", "MD4"],
        40: ["SHA-1"],
        56: ["SHA-224"],
        64: ["SHA-256"],
        96: ["SHA-384"],
        128: ["SHA-512"],
    }
    return _hash_result(by_len.get(len(d), []))


def _hash_result(candidates: List[str]) -> Dict[str, Any]:
    if not candidates:
        return {"candidates": [], "kdf": False, "severity": "info",
                "note": "Unrecognised digest length."}
    sevs = [_HASH_WEAK[c][0] for c in candidates if c in _HASH_WEAK]
    worst = _worst_severity(sevs) if sevs else "info"
    note = next((_HASH_WEAK[c][1] for c in candidates if c in _HASH_WEAK), "")
    return {"candidates": candidates, "kdf": False, "severity": worst, "note": note}


def hash_findings(digest: str) -> List[Dict[str, Any]]:
    r = identify_hash(digest)
    if r["kdf"] or not r["candidates"] or r["severity"] == "info":
        return []
    cands = "/".join(r["candidates"])
    return [_finding(f"Weak password hash detected ({cands})", r["severity"],
                     f"Digest matches {cands}: {digest[:12]}…", r["note"])]


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

    @reg.capability(
        name="crypto.hash_audit",
        authorization="passive",
        description="Identify a hash digest and flag broken/fast algorithms used for "
                    "password storage (recommend a slow KDF).",
        inputs={"digest": "str", "digests": "list[str]? (audit many)"},
        outputs={"candidates": "list", "kdf": "bool", "findings": "list"},
    )
    def _hash_audit(ctx, inputs: Dict[str, Any]) -> Dict[str, Any]:
        many = inputs.get("digests")
        if many:
            findings: List[Dict[str, Any]] = []
            ids = []
            for d in many:
                ids.append({"digest": str(d), **identify_hash(str(d))})
                findings.extend(hash_findings(str(d)))
            return {"identified": ids, "findings": findings, "weak": len(findings)}
        digest = str(inputs.get("digest") or "")
        r = identify_hash(digest)
        return {**r, "findings": hash_findings(digest), "weak": len(hash_findings(digest))}
