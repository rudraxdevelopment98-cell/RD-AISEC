// Tests the pure, security-critical helpers of AI browsing: scope parsing,
// in-scope host matching, and the SSRF public-IP guard. Run with `npm test` (tsx).

import assert from "node:assert";
import { scopeHosts, hostInScope, isPublicIp } from "./ai-browse";

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok -", name);
}

t("scopeHosts parses URLs, bare domains, and wildcards", () => {
  const hosts = scopeHosts("https://app.example.com/login\n*.api.example.com\nfoo.test.io , http://bar.test.io:8080/x");
  assert.deepStrictEqual(
    hosts.sort(),
    ["api.example.com", "app.example.com", "bar.test.io", "foo.test.io"].sort(),
  );
});

t("scopeHosts drops non-hosts (CIDRs, empties, bare words)", () => {
  const hosts = scopeHosts("10.0.0.0/24\n\nlocalhost\nnotahost\nexample.com");
  assert.deepStrictEqual(hosts, ["example.com"]);
});

t("hostInScope matches exact host and subdomains only", () => {
  const hosts = ["example.com"];
  assert.strictEqual(hostInScope("example.com", hosts), true);
  assert.strictEqual(hostInScope("api.example.com", hosts), true);
  assert.strictEqual(hostInScope("deep.api.example.com", hosts), true);
  assert.strictEqual(hostInScope("notexample.com", hosts), false);
  assert.strictEqual(hostInScope("example.com.evil.com", hosts), false);
});

t("isPublicIp rejects private / loopback / link-local / metadata v4", () => {
  for (const ip of ["10.1.2.3", "172.16.0.1", "172.31.255.1", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1"]) {
    assert.strictEqual(isPublicIp(ip), false, `${ip} should be non-public`);
  }
});

t("isPublicIp allows real public v4", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "203.0.113.10", "172.32.0.1"]) {
    assert.strictEqual(isPublicIp(ip), true, `${ip} should be public`);
  }
});

t("isPublicIp handles v6 loopback, ULA, link-local, and mapped v4", () => {
  assert.strictEqual(isPublicIp("::1"), false);
  assert.strictEqual(isPublicIp("fc00::1"), false);
  assert.strictEqual(isPublicIp("fe80::1"), false);
  assert.strictEqual(isPublicIp("::ffff:127.0.0.1"), false);
  assert.strictEqual(isPublicIp("::ffff:8.8.8.8"), true);
  assert.strictEqual(isPublicIp("2606:4700:4700::1111"), true);
});

console.log(`\n${passed} passed`);
