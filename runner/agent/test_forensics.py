"""
Tests for the forensics IOC-triage capability — run:  python3 test_forensics.py

Extracts + classifies indicators from a defanged threat-report paste (the form
analysts actually share), and proves hashes don't collide, private/public IPs are
split, filenames aren't mistaken for domains, and CVEs/BTC surface as findings.
"""
import sys
import forensics as F
from capabilities import Registry

PASS = FAIL = 0
def ok(c, m):
    global PASS, FAIL
    PASS += c; FAIL += (not c)
    print(("  ✓ " if c else "  ✗ ") + m)

REPORT = """
Indicators (defanged):
  C2:      hxxps://evil[.]example[.]com/gate.php
  Backup:  1.2.3[.]4  and internal 192.168.1.50
  Drop:    http://203.0.113.9/payload.exe
  Contact: attacker[at]proton[.]me
  MD5:     44d88612fea8a8f36de82e1278abb02f
  SHA256:  e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  Exploits CVE-2021-44228 and cve-2014-0160
  Wallet:  1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa
"""

iocs = F.extract_iocs(REPORT)

print("refang restores the shareable/defanged forms")
r = F.refang("hxxps://evil[.]com attacker[at]mail[.]com 1[.]2[.]3[.]4")
ok("https://evil.com" in r, "hxxps + [.] refanged")
ok("attacker@mail.com" in r, "[at] refanged to @")
ok("1.2.3.4" in r, "bracketed-dot IP refanged")

print("URLs, emails, IPs")
ok("https://evil.example.com/gate.php" in iocs["urls"], "C2 URL extracted")
ok("http://203.0.113.9/payload.exe" in iocs["urls"], "drop URL extracted")
ok("attacker@proton.me" in iocs["emails"], "email extracted")
ipmap = {i["value"]: i["scope"] for i in iocs["ipv4"]}
ok(ipmap.get("1.2.3.4") == "public", "public IP classified public")
ok(ipmap.get("192.168.1.50") == "private", "RFC1918 IP classified private")
ok(ipmap.get("203.0.113.9") == "public", "URL-host IP also captured as an IP")

print("hashes are classified without collision")
ok(iocs["hashes"]["md5"] == ["44d88612fea8a8f36de82e1278abb02f"], "MD5 captured")
ok(iocs["hashes"]["sha256"] == ["e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
   "SHA-256 captured")
ok(iocs["hashes"]["sha1"] == [], "no false SHA-1 from slicing the SHA-256")

print("domains exclude URL/email hosts, IPs and filenames")
ok("evil.example.com" not in iocs["domains"], "URL host not double-listed as a bare domain")
ok("proton.me" not in iocs["domains"], "email host not double-listed as a bare domain")
ok(all(not d.endswith(".exe") and not d.endswith(".php") for d in iocs["domains"]),
   "filenames (gate.php / payload.exe) are not domains")

print("CVEs and crypto wallet")
ok(set(iocs["cves"]) == {"CVE-2021-44228", "CVE-2014-0160"}, "both CVEs, normalised upper-case")
ok("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" in iocs["btc"], "bitcoin address extracted")

print("triage findings + count")
finds = F.triage_findings(iocs)
titles = " | ".join(f["title"] for f in finds)
ok("CVE-2021-44228" in titles, "a CVE becomes a finding")
ok("Cryptocurrency" in titles, "the BTC address becomes a finding")
ok(F.ioc_count(iocs) >= 8, f"count aggregates all indicator classes ({F.ioc_count(iocs)})")

print("empty / clean text yields nothing")
clean = F.extract_iocs("just some ordinary prose with no indicators at all")
ok(F.ioc_count(clean) == 0, "clean text → zero IOCs")
ok(F.triage_findings(clean) == [], "clean text → no findings")

print("registered capability, passive")
reg = Registry(); F.register(reg)
cap = reg.get("forensics.iocs")
ok(cap.authorization == "passive", "forensics.iocs is passive (reads text, touches no host)")
out = cap.run(None, {"text": REPORT})
ok(out["count"] == F.ioc_count(iocs) and len(out["findings"]) == 3,
   "capability returns count + findings (2 CVEs + 1 BTC)")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
