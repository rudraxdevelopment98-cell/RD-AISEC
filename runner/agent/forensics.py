"""
Forensics triage capability (forensics.iocs) — Runner v2.

Pulls indicators of compromise out of arbitrary text — logs, an email header
block, a paste, a report — and classifies them: IPv4 (public vs private), domains,
URLs, emails, file hashes (MD5/SHA-1/SHA-256), CVE ids, and Bitcoin addresses.
Handles the "defanged" forms analysts share (hxxp://, 1.2.3[.]4, evil[.]com) so a
pasted threat report parses cleanly. Pure parsing — fully testable offline.

Passive by authorization: it reads text you already have, it touches no host.
This is the seed of the digital-forensics pillar; enrichment (reputation lookups,
timeline building) layers on top as further passive/active capabilities.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List


# ── Refang: undo the defanging analysts use to share IOCs safely ─────────────
def refang(text: str) -> str:
    t = text
    t = re.sub(r"h(?:xx|XX)p(s?)://", r"http\1://", t)
    t = re.sub(r"\[(\.|dot)\]", ".", t, flags=re.I)
    t = re.sub(r"\((\.|dot)\)", ".", t, flags=re.I)
    t = re.sub(r"\s+(?:dot)\s+", ".", t, flags=re.I)
    t = t.replace("[://]", "://").replace("[:]", ":")
    t = re.sub(r"\[at\]|\(at\)", "@", t, flags=re.I)
    return t


_IPV4 = re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b")
_URL = re.compile(r"\bhttps?://[^\s\"'<>()\]]+", re.I)
_EMAIL = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")
_DOMAIN = re.compile(r"\b(?:[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b", re.I)
_MD5 = re.compile(r"\b[a-f0-9]{32}\b", re.I)
_SHA1 = re.compile(r"\b[a-f0-9]{40}\b", re.I)
_SHA256 = re.compile(r"\b[a-f0-9]{64}\b", re.I)
_CVE = re.compile(r"\bCVE-\d{4}-\d{4,7}\b", re.I)
_BTC = re.compile(r"\b(?:bc1[a-z0-9]{25,39}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b")

# Common file-extension "domains" that are really filenames — don't treat as hosts.
_FILE_TLDS = {"exe", "dll", "php", "html", "htm", "js", "png", "jpg", "gif", "txt",
              "doc", "docx", "xls", "pdf", "zip", "dat", "bin", "sys", "bat", "ps1"}


def _is_private_ip(ip: str) -> bool:
    o = [int(x) for x in ip.split(".")]
    return (o[0] == 10 or (o[0] == 172 and 16 <= o[1] <= 31) or (o[0] == 192 and o[1] == 168)
            or o[0] == 127 or (o[0] == 169 and o[1] == 254) or o[0] == 0)


def _host_of_url(u: str) -> str:
    return re.sub(r"^https?://", "", u, flags=re.I).split("/")[0].split(":")[0].split("@")[-1]


def extract_iocs(text: str) -> Dict[str, Any]:
    """Extract + classify IOCs from text. Returns sorted, de-duplicated lists."""
    t = refang(text or "")

    urls = sorted(set(_URL.findall(t)))
    emails = sorted(set(_EMAIL.findall(t)))
    sha256 = sorted({h.lower() for h in _SHA256.findall(t)})
    sha1 = sorted({h.lower() for h in _SHA1.findall(t)})
    # An MD5 pattern also matches the first 32 hex of a longer hash — exclude any
    # 32-hex run that's actually a slice of a 40/64-hex digest.
    long_hex = set(_SHA1.findall(t.lower())) | set(_SHA256.findall(t.lower()))
    md5 = sorted({h.lower() for h in _MD5.findall(t)
                  if not any(h.lower() in lh for lh in long_hex)})

    ips = sorted(set(_IPV4.findall(t)))
    ipv4 = [{"value": ip, "scope": "private" if _is_private_ip(ip) else "public"} for ip in ips]

    # Domains: drop ones that are really email hosts, URL hosts, IPs, or filenames,
    # so the domain list is the *standalone* ones worth enriching.
    url_hosts = {_host_of_url(u).lower() for u in urls}
    email_hosts = {e.split("@")[-1].lower() for e in emails}
    domains = []
    for d in sorted({d.lower() for d in _DOMAIN.findall(t)}):
        if _IPV4.fullmatch(d):
            continue
        if d.rsplit(".", 1)[-1] in _FILE_TLDS:
            continue
        if d in url_hosts or d in email_hosts:
            continue
        domains.append(d)

    return {
        "ipv4": ipv4,
        "domains": domains,
        "urls": urls,
        "emails": emails,
        "hashes": {"md5": md5, "sha1": sha1, "sha256": sha256},
        "cves": sorted({c.upper() for c in _CVE.findall(t)}),
        "btc": sorted(set(_BTC.findall(t))),
    }


def ioc_count(iocs: Dict[str, Any]) -> int:
    h = iocs.get("hashes", {})
    return (len(iocs.get("ipv4", [])) + len(iocs.get("domains", [])) + len(iocs.get("urls", []))
            + len(iocs.get("emails", [])) + len(h.get("md5", [])) + len(h.get("sha1", []))
            + len(h.get("sha256", [])) + len(iocs.get("cves", [])) + len(iocs.get("btc", [])))


def triage_findings(iocs: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Turn notable indicators into findings — CVEs referenced and public C2-ish
    indicators (public IPs / bitcoin addresses) are worth surfacing."""
    out: List[Dict[str, Any]] = []
    for cve in iocs.get("cves", []):
        out.append({"title": f"CVE referenced: {cve}", "severity": "medium",
                    "category": "forensics", "evidence": cve,
                    "recommendation": "Confirm affected assets and patch status for this CVE."})
    if iocs.get("btc"):
        out.append({"title": "Cryptocurrency address present (possible ransom/C2)",
                    "severity": "medium", "category": "forensics",
                    "evidence": ", ".join(iocs["btc"][:5]),
                    "recommendation": "Correlate the address with known ransomware/extortion campaigns."})
    return out


def register(reg) -> None:
    @reg.capability(
        name="forensics.iocs",
        authorization="passive",
        description="Extract + classify indicators of compromise from text (IPs, "
                    "domains, URLs, emails, hashes, CVEs, BTC), refanging as needed.",
        inputs={"text": "str", "path": "str? (read the text from disk)"},
        outputs={"iocs": "dict", "count": "int", "findings": "list"},
    )
    def _iocs(ctx, inputs: Dict[str, Any]) -> Dict[str, Any]:
        text = inputs.get("text")
        if not text and inputs.get("path"):
            with open(str(inputs["path"]), "r", errors="replace") as f:
                text = f.read()
        iocs = extract_iocs(str(text or ""))
        return {"iocs": iocs, "count": ioc_count(iocs), "findings": triage_findings(iocs)}
