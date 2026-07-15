"""Crypto posture tests — run:  python3 test_crypto.py"""
import sys
from crypto import analyze, cipher_weakness, has_forward_secrecy, parse_sslscan

PASS = FAIL = 0
def ok(c, m):
    global PASS, FAIL
    PASS += c; FAIL += (not c)
    print(("  ✓ " if c else "  ✗ ") + m)

print("cipher weakness classification")
ok(cipher_weakness("ECDHE-RSA-AES256-GCM-SHA384") is None, "strong modern cipher → not weak")
ok(cipher_weakness("RC4-SHA")[0] == "high", "RC4 → high")
ok(cipher_weakness("DES-CBC3-SHA")[0] == "medium", "3DES → medium (SWEET32)")
ok(cipher_weakness("EXP-RC4-MD5")[0] == "high", "EXPORT → high")
ok(cipher_weakness("NULL-SHA")[0] == "critical", "NULL → critical")
ok(cipher_weakness("ADH-AES256-SHA")[0] == "critical", "anon DH → critical")

print("forward secrecy")
ok(has_forward_secrecy(["ECDHE-RSA-AES128-GCM-SHA256"]) is True, "ECDHE → FS present")
ok(has_forward_secrecy(["AES256-SHA"]) is False, "static RSA → no FS")

print("full analysis → findings")
res = analyze(
    protocols=["TLSv1.0", "TLSv1.2", "SSLv3"],
    ciphers=["ECDHE-RSA-AES256-GCM-SHA384", "RC4-SHA", "DES-CBC3-SHA"],
    cert={"keyBits": 1024, "sigAlgo": "sha1WithRSAEncryption", "selfSigned": True},
    host="acme.io",
)
titles = [f["title"] for f in res["findings"]]
ok(any("SSLv3" in t for t in titles), "flags SSLv3")
ok(any("TLSv1.0" in t for t in titles), "flags TLS 1.0")
ok(any("RC4" in t for t in titles), "flags RC4 cipher")
ok(any("1024-bit" in t for t in titles), "flags weak 1024-bit key")
ok(any("SHA-1" in t for t in titles), "flags SHA-1 cert signature")
ok(any("Self-signed" in t for t in titles), "flags self-signed cert")
ok(res["worst"] == "high", f"worst severity = high (got {res['worst']})")
ok(res["weak"] == len(res["findings"]) and res["weak"] >= 6, f"weak count = {res['weak']}")

print("strong config → no findings")
clean = analyze(protocols=["TLSv1.2", "TLSv1.3"],
                ciphers=["ECDHE-RSA-AES256-GCM-SHA384", "ECDHE-ECDSA-CHACHA20-POLY1305"],
                cert={"keyBits": 2048, "sigAlgo": "sha256WithRSAEncryption"}, host="secure.io")
ok(clean["weak"] == 0, "modern TLS 1.2/1.3 + strong ciphers → 0 findings")

print("sslscan parser")
sample = """
  SSLv3     enabled
  TLSv1.0   enabled
  TLSv1.2   enabled
Accepted  TLSv1.2  256 bits  ECDHE-RSA-AES256-GCM-SHA384
Accepted  TLSv1.0  128 bits  RC4-SHA
  RSA Key Strength:    1024
  Signature Algorithm: sha1WithRSAEncryption
"""
p = parse_sslscan(sample)
ok("SSLv3" in p["protocols"] and "TLSv1.0" in p["protocols"], "parsed enabled protocols")
ok("RC4-SHA" in p["ciphers"], "parsed accepted ciphers")
ok(p["cert"]["keyBits"] == 1024, "parsed cert key bits")
res2 = analyze(**{k: p[k] for k in ("protocols", "ciphers")}, cert=p["cert"], host="x.io")
ok(res2["weak"] >= 4, "end-to-end parse→analyze produces findings")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
