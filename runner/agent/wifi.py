"""
WiFi survey capability (wifi.survey) — Runner v2.

Turns a passive airodump-ng capture (its CSV) into a structured picture of the
airspace: access points and the client stations around them, each with a vendor
guess (OUI), a rough distance estimate from signal strength, and a security-
posture judgement (open / WEP / weak-WPA). This is the data the portal's home-map
draws from — real APs and real devices, positioned by signal, not mocked.

Passive by authorization: listening to beacons/probes that are already in the air
is observation, not an active touch — so it runs without a per-host grant. Pure
parsing + math, so it's fully testable offline against a saved capture.
"""
from __future__ import annotations

import csv
import io
import math
from typing import Any, Dict, List, Optional


# A tiny, best-effort OUI → vendor map. The real runner can ship the full IEEE
# list; this covers the common ones so the survey is useful with zero deps.
OUI: Dict[str, str] = {
    "F0:9F:C2": "Ubiquiti", "FC:EC:DA": "Ubiquiti",
    "00:1A:11": "Google", "3C:5A:B4": "Google", "F4:F5:E8": "Google",
    "AC:DE:48": "Apple", "F0:18:98": "Apple", "A4:83:E7": "Apple",
    "DC:A6:32": "Raspberry Pi", "B8:27:EB": "Raspberry Pi", "E4:5F:01": "Raspberry Pi",
    "50:C7:BF": "TP-Link", "C0:25:E9": "TP-Link", "AC:84:C6": "TP-Link",
    "00:0C:29": "VMware", "00:1C:42": "Parallels", "00:50:56": "VMware",
    "00:11:22": "Cimsys", "18:FE:34": "Espressif", "24:6F:28": "Espressif",
    "B4:E6:2D": "Espressif", "7C:9E:BD": "Espressif",
    "00:1D:0F": "TP-Link", "60:E3:27": "TP-Link",
}


def vendor_for(mac: str) -> str:
    """Best-effort vendor from the OUI (first 3 octets). '' if unknown."""
    if not mac or len(mac) < 8:
        return ""
    return OUI.get(mac.upper()[:8], "")


def estimate_distance_m(power_dbm: Optional[int], tx_ref_dbm: int = -40, path_loss_n: float = 2.7) -> Optional[float]:
    """Rough free-space-ish distance (metres) from RSSI via the log-distance path
    loss model: d = 10 ^ ((TxRef - RSSI) / (10 * n)). Indoor n≈2.7. This is an
    ESTIMATE for map placement, never a measurement — airodump 'Power' of 0/-1
    means 'no reading', so we return None there."""
    if power_dbm is None or power_dbm >= 0:
        return None
    d = 10 ** ((tx_ref_dbm - power_dbm) / (10 * path_loss_n))
    return round(max(0.1, min(d, 500.0)), 1)


def _posture(privacy: str, cipher: str) -> Optional[Dict[str, str]]:
    """Judge an AP's encryption. None if fine (WPA2/WPA3 with a real cipher)."""
    p = (privacy or "").upper().strip()
    c = (cipher or "").upper()
    if p in ("", "OPN") or "OPN" in p:
        return {"severity": "high", "note": "Open network — no encryption; traffic is in the clear."}
    if "WEP" in p:
        return {"severity": "high", "note": "WEP — cryptographically broken; crackable in minutes."}
    if "TKIP" in c or (p == "WPA" and "CCMP" not in c):
        return {"severity": "medium", "note": "WPA/TKIP — deprecated cipher; upgrade to WPA2/WPA3-CCMP."}
    return None


def _to_int(x: str) -> Optional[int]:
    x = (x or "").strip()
    try:
        return int(x)
    except ValueError:
        return None


def parse_airodump_csv(text: str) -> Dict[str, Any]:
    """Parse an airodump-ng CSV (the `-w … --output-format csv` file) into
    {aps: [...], stations: [...]}. The file has two blocks: APs, then stations,
    separated by a blank line. Robust to extra whitespace and short rows."""
    lines = text.splitlines()
    # Split on the blank line between the two sections.
    split = next((i for i, ln in enumerate(lines) if ln.strip() == "" and i > 0), len(lines))
    ap_block = [ln for ln in lines[:split] if ln.strip()]
    st_block = [ln for ln in lines[split:] if ln.strip()]

    aps: List[Dict[str, Any]] = []
    if ap_block and ap_block[0].lower().lstrip().startswith("bssid"):
        for row in csv.reader(ap_block[1:]):
            row = [c.strip() for c in row]
            if len(row) < 14 or not row[0]:
                continue
            bssid = row[0].upper()
            power = _to_int(row[8])
            ap = {
                "bssid": bssid,
                "channel": _to_int(row[3]),
                "privacy": row[5],
                "cipher": row[6],
                "auth": row[7],
                "power": power,
                "essid": row[13],
                "vendor": vendor_for(bssid),
                "distance_m": estimate_distance_m(power),
                "clients": [],
            }
            posture = _posture(row[5], row[6])
            if posture:
                ap["posture"] = posture
            aps.append(ap)

    by_bssid = {a["bssid"]: a for a in aps}
    stations: List[Dict[str, Any]] = []
    if st_block and st_block[0].lower().lstrip().startswith("station"):
        for row in csv.reader(st_block[1:]):
            row = [c.strip() for c in row]
            if len(row) < 6 or not row[0]:
                continue
            mac = row[0].upper()
            power = _to_int(row[3])
            assoc = row[5].upper() if row[5] and row[5].upper() != "(NOT ASSOCIATED)" else ""
            # Probed ESSIDs are themselves comma-separated, so they spill across
            # the remaining columns once the CSV reader splits on commas — rejoin.
            probes = [p.strip() for p in row[6:] if p.strip()]
            st = {
                "mac": mac,
                "power": power,
                "associated_bssid": assoc,
                "vendor": vendor_for(mac),
                "distance_m": estimate_distance_m(power),
                "probes": probes,
            }
            stations.append(st)
            if assoc in by_bssid:
                by_bssid[assoc]["clients"].append(mac)

    return {"aps": aps, "stations": stations}


def survey_findings(parsed: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Security findings from a parsed survey — currently weak-encryption APs."""
    out: List[Dict[str, Any]] = []
    for ap in parsed.get("aps", []):
        p = ap.get("posture")
        if p:
            name = ap.get("essid") or ap["bssid"]
            out.append({
                "title": f"WiFi: {p['severity']} — {name}",
                "severity": p["severity"],
                "category": "wifi",
                "evidence": f"{name} ({ap['bssid']}) privacy={ap.get('privacy')} cipher={ap.get('cipher')}",
                "recommendation": p["note"],
            })
    return out


def register(reg) -> None:
    @reg.capability(
        name="wifi.survey",
        authorization="passive",
        description="Turn an airodump-ng CSV capture into APs + client devices with "
                    "vendor, distance estimate, and security posture (for the home map).",
        inputs={"csv": "str (airodump CSV)", "path": "str? (read the CSV from disk)"},
        outputs={"aps": "list", "stations": "list", "findings": "list"},
    )
    def _survey(ctx, inputs: Dict[str, Any]) -> Dict[str, Any]:
        text = inputs.get("csv")
        if not text and inputs.get("path"):
            with open(str(inputs["path"]), "r", errors="replace") as f:
                text = f.read()
        parsed = parse_airodump_csv(str(text or ""))
        parsed["findings"] = survey_findings(parsed)
        parsed["ap_count"] = len(parsed["aps"])
        parsed["station_count"] = len(parsed["stations"])
        return parsed
