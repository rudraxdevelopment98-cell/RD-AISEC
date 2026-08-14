// Tests the two-account IDOR orchestration: candidate gathering + result parsing.
// Run with `npm test` (tsx).

import assert from "node:assert";
import { buildIdorEndpoints, parseIdorResult } from "./idor-scan";

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok -", name);
}

t("buildIdorEndpoints: extracts object-id URLs, ranks sensitive+enumerable first", () => {
  const eps = buildIdorEndpoints([
    { title: "Endpoint found", description: "https://t.example/api/invoice/44 and https://t.example/api/health" },
    { title: "Another", description: "see https://t.example/api/avatar/9" },
  ]);
  const urls = eps.map((e) => e.url);
  assert.ok(urls.includes("https://t.example/api/invoice/44"), "invoice endpoint kept");
  assert.ok(urls.includes("https://t.example/api/avatar/9"), "avatar endpoint kept");
  assert.ok(!urls.some((u) => u.includes("/health")), "no-id endpoint dropped");
  assert.strictEqual(eps[0].url, "https://t.example/api/invoice/44", "sensitive+enumerable first");
});

t("buildIdorEndpoints: dedupes repeated URLs", () => {
  const eps = buildIdorEndpoints([
    { title: "a", description: "https://t.example/api/orders/1" },
    { title: "b", description: "https://t.example/api/orders/1 again" },
  ]);
  assert.strictEqual(eps.length, 1);
});

t("parseIdorResult: marker leak to account B → confirmed BOLA critical", () => {
  const out = JSON.stringify({
    probes: [{ ep: "GET https://t/api/orders/1001", o: { s: 200, n: 500, m: true }, a: { s: 200, n: 500, m: true }, x: { s: 403, n: 10, m: false } }],
  });
  const f = parseIdorResult(out, "alice@example.com");
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].severity, "critical");
  assert.ok(/IDOR \/ BOLA/.test(f[0].title));
});

t("parseIdorResult: account B denied → no finding", () => {
  const out = JSON.stringify({
    probes: [{ ep: "GET https://t/api/orders/1001", o: { s: 200, n: 500, m: false }, a: { s: 403, n: 10, m: false } }],
  });
  assert.strictEqual(parseIdorResult(out, "alice@example.com").length, 0);
});

t("parseIdorResult: anon marker leak → unauth finding", () => {
  const out = JSON.stringify({
    probes: [{ ep: "GET https://t/api/profile/7", o: { s: 200, n: 300, m: true }, a: { s: 403, n: 10, m: false }, x: { s: 200, n: 300, m: true } }],
  });
  const f = parseIdorResult(out, "alice@example.com");
  assert.strictEqual(f.length, 1);
  assert.ok(/Unauthenticated object access/.test(f[0].title));
  assert.strictEqual(f[0].severity, "critical");
});

t("parseIdorResult: missing baseline (owner failed) → no finding", () => {
  const out = JSON.stringify({
    probes: [{ ep: "GET https://t/api/orders/1001", o: { s: 404, n: 0, m: false }, a: { s: 200, n: 500, m: false } }],
  });
  assert.strictEqual(parseIdorResult(out, "").length, 0);
});

t("parseIdorResult: malformed output → empty, no throw", () => {
  assert.strictEqual(parseIdorResult("not json", "x").length, 0);
  assert.strictEqual(parseIdorResult("{}", "x").length, 0);
});

console.log(`\nidor-scan: ${passed} checks passed`);
