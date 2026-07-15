"""
Tests for the WiFi survey capability — run:  python3 test_wifi.py

Parses a real-shaped airodump-ng CSV into APs + stations, checks vendor lookup,
signal→distance estimation, weak-encryption posture, and client→AP association —
the data the home map is drawn from. Fully offline against embedded capture text.
"""
import sys
import wifi
from capabilities import Registry

PASS = FAIL = 0
def ok(c, m):
    global PASS, FAIL
    PASS += c; FAIL += (not c)
    print(("  ✓ " if c else "  ✗ ") + m)

# Two APs (one WPA2, one open) and two client stations, one associated.
CSV = """BSSID, First time seen, Last time seen, channel, Speed, Privacy, Cipher, Authentication, Power, # beacons, # IV, LAN IP, ID-length, ESSID, Key
50:C7:BF:11:22:33, 2026-07-15 10:00:00, 2026-07-15 10:05:00, 6, 130, WPA2, CCMP, PSK, -52, 100, 0, 0.0.0.0, 9, HomeNet,
AC:DE:48:00:00:01, 2026-07-15 10:00:00, 2026-07-15 10:05:00, 11, 54, OPN, , , -70, 40, 0, 0.0.0.0, 8, CafeGuest,

Station MAC, First time seen, Last time seen, Power, # packets, BSSID, Probed ESSIDs
B8:27:EB:AA:BB:CC, 2026-07-15 10:01:00, 2026-07-15 10:05:00, -48, 200, 50:C7:BF:11:22:33, HomeNet
F0:18:98:DD:EE:FF, 2026-07-15 10:02:00, 2026-07-15 10:05:00, -60, 50, (not associated), HomeNet,CafeGuest
"""

parsed = wifi.parse_airodump_csv(CSV)

print("parses both sections of the capture")
ok(len(parsed["aps"]) == 2, f"two APs parsed ({len(parsed['aps'])})")
ok(len(parsed["stations"]) == 2, f"two stations parsed ({len(parsed['stations'])})")

aps = {a["essid"]: a for a in parsed["aps"]}
print("AP fields, vendor and distance")
ok(aps["HomeNet"]["bssid"] == "50:C7:BF:11:22:33", "BSSID captured")
ok(aps["HomeNet"]["channel"] == 6, "channel parsed as int")
ok(aps["HomeNet"]["vendor"] == "TP-Link", f"vendor from OUI ({aps['HomeNet']['vendor']})")
ok(aps["HomeNet"]["distance_m"] is not None and aps["HomeNet"]["distance_m"] > 0,
   f"distance estimated from power ({aps['HomeNet']['distance_m']} m)")
ok(aps["CafeGuest"]["distance_m"] > aps["HomeNet"]["distance_m"],
   "weaker signal (-70) estimates farther than stronger (-52)")

print("security posture")
ok("posture" not in aps["HomeNet"], "WPA2/CCMP AP has no posture flag (fine)")
ok(aps["CafeGuest"]["posture"]["severity"] == "high", "open network flagged high")
findings = wifi.survey_findings(parsed)
ok(len(findings) == 1 and findings[0]["category"] == "wifi", "one wifi finding (the open AP)")
ok("CafeGuest" in findings[0]["title"], "finding names the offending SSID")

print("client stations and association")
home = aps["HomeNet"]
ok("B8:27:EB:AA:BB:CC" in home["clients"], "associated client linked to its AP")
sts = {s["mac"]: s for s in parsed["stations"]}
ok(sts["B8:27:EB:AA:BB:CC"]["vendor"] == "Raspberry Pi", "station vendor from OUI")
ok(sts["B8:27:EB:AA:BB:CC"]["associated_bssid"] == "50:C7:BF:11:22:33", "association recorded")
ok(sts["F0:18:98:DD:EE:FF"]["associated_bssid"] == "", "unassociated station has no BSSID")
ok(sts["F0:18:98:DD:EE:FF"]["probes"] == ["HomeNet", "CafeGuest"], "probed ESSIDs parsed")

print("distance model")
ok(wifi.estimate_distance_m(-40) is not None, "strong signal → a near distance")
ok(wifi.estimate_distance_m(0) is None, "power 0 means no reading → None")
ok(wifi.estimate_distance_m(None) is None, "missing power → None")
ok(wifi.estimate_distance_m(-90) > wifi.estimate_distance_m(-50), "monotonic: weaker → farther")

print("WEP is flagged high, TKIP medium")
wep = wifi.parse_airodump_csv(
    "BSSID, a, b, channel, s, Privacy, Cipher, Auth, Power, x, y, ip, idl, ESSID, Key\n"
    "00:11:22:33:44:55, t, t, 1, 54, WEP, WEP, , -55, 1, 0, 0, 3, OldAP, \n")
ok(wep["aps"][0]["posture"]["severity"] == "high", "WEP → high")
tkip = wifi.parse_airodump_csv(
    "BSSID, a, b, channel, s, Privacy, Cipher, Auth, Power, x, y, ip, idl, ESSID, Key\n"
    "00:11:22:33:44:66, t, t, 1, 54, WPA, TKIP, PSK, -55, 1, 0, 0, 3, MidAP, \n")
ok(tkip["aps"][0]["posture"]["severity"] == "medium", "WPA/TKIP → medium")

print("registered capability runs through the registry, passive (no grant)")
reg = Registry(); wifi.register(reg)
cap = reg.get("wifi.survey")
ok(cap.authorization == "passive", "wifi.survey is passive (listening only)")
out = cap.run(None, {"csv": CSV})
ok(out["ap_count"] == 2 and out["station_count"] == 2, "capability returns counts")
ok(len(out["findings"]) == 1, "capability surfaces the open-network finding")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
