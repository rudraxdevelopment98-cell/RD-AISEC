"""
Tests for the web posture capability — run:  python3 test_web.py

Proves analyze_headers() flags the common HTTP-hardening gaps (OWASP A05),
gives a fully-hardened response a clean bill of health, and that the raw
header-block parser round-trips into the same judgement.
"""
import sys
import web

PASS = FAIL = 0
def ok(c, m):
    global PASS, FAIL
    PASS += c; FAIL += (not c)
    print(("  ✓ " if c else "  ✗ ") + m)

def titles(r):
    return " | ".join(f["title"] for f in r["findings"])

print("a bare response trips every core header check")
bare = web.analyze_headers({"Content-Type": "text/html"}, "https://acme.io")
t = titles(bare)
ok("HSTS" in t, "missing HSTS flagged")
ok("Content-Security-Policy" in t, "missing CSP flagged")
ok("clickjacking" in t, "missing clickjacking protection flagged")
ok("X-Content-Type-Options" in t, "missing nosniff flagged")
ok("Referrer-Policy" in t, "missing Referrer-Policy flagged")
ok(bare["worst"] == "medium", f"worst severity is medium ({bare['worst']})")
ok(bare["weak"] >= 5, f"at least 5 findings ({bare['weak']})")

print("a fully-hardened response is clean")
hard = web.analyze_headers({
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Set-Cookie": "sid=abc; Secure; HttpOnly; SameSite=Strict",
}, "https://secure.io")
ok(hard["weak"] == 0, f"no findings on a hardened host ({hard['weak']}: {titles(hard)})")
ok(hard["worst"] == "info", "worst severity is info when clean")

print("CSP frame-ancestors satisfies clickjacking without X-Frame-Options")
csp_only = web.analyze_headers({
    "Content-Security-Policy": "frame-ancestors 'none'",
}, "")
ok("clickjacking" not in titles(csp_only), "CSP frame-ancestors accepted in lieu of X-Frame-Options")

print("version/tech disclosure is flagged")
disc = web.analyze_headers({"Server": "nginx/1.18.0", "X-Powered-By": "PHP/8.1.2"}, "")
dt = titles(disc)
ok("Version disclosure via server" in dt, "Server version disclosure flagged")
ok("Version disclosure via x-powered-by" in dt, "X-Powered-By version disclosure flagged")
ok(not any("Version disclosure" in f["title"] for f in
           web.analyze_headers({"Server": "cloudflare"}, "")["findings"]),
   "a version-less Server value is NOT flagged")

print("unsafe cookie flags are caught")
ck = web.analyze_headers({"Set-Cookie": "sid=abc; Path=/"}, "")
ct = titles(ck)
ok("Secure flag" in ct, "cookie missing Secure flagged")
ok("HttpOnly flag" in ct, "cookie missing HttpOnly flagged")

print("parse_header_block round-trips a raw block into the same judgement")
raw = """HTTP/1.1 200 OK
Server: nginx/1.18.0
Content-Type: text/html
Set-Cookie: sid=abc; Path=/
"""
parsed = web.parse_header_block(raw)
ok(parsed.get("Server") == "nginx/1.18.0", "parsed Server header")
ok("HTTP/1.1" not in parsed, "status line is not treated as a header")
r = web.analyze_headers(parsed, "https://acme.io")
ok(any("HSTS" in f["title"] for f in r["findings"]), "parsed block feeds analyze_headers")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
