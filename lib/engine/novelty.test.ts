// Tests the pure novelty/dedupe core (P2). Run with `npm test` (tsx).

import assert from "node:assert";
import { findingSignature, simhash, hamming, isDuplicate, assessNovelty } from "./novelty";

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok -", name);
}

t("signature collapses volatile ids in the same endpoint", () => {
  const a = findingSignature({ title: "IDOR", asset: "https://api.acme.com/orders/1001" });
  const b = findingSignature({ title: "IDOR", asset: "https://api.acme.com/orders/99872" });
  assert.strictEqual(a, b, `expected same signature, got "${a}" vs "${b}"`);
});

t("different host or class → different signature", () => {
  const a = findingSignature({ title: "IDOR", asset: "https://api.acme.com/orders/1" });
  const b = findingSignature({ title: "IDOR", asset: "https://api.globex.com/orders/1" });
  const c = findingSignature({ title: "XSS", asset: "https://api.acme.com/orders/1" });
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a, c);
});

t("simhash of identical signatures is equal; near-identical is close", () => {
  const s1 = simhash(findingSignature({ title: "IDOR", asset: "https://api.acme.com/orders/1" }));
  const s2 = simhash(findingSignature({ title: "IDOR", asset: "https://api.acme.com/orders/2" }));
  assert.strictEqual(hamming(s1, s2), 0);
});

t("isDuplicate catches a re-report of the same endpoint+class", () => {
  const prior = simhash(findingSignature({ title: "IDOR on order", asset: "https://api.acme.com/orders/1" }));
  const now = simhash(findingSignature({ title: "IDOR", asset: "https://api.acme.com/orders/555" }));
  assert.strictEqual(isDuplicate(now, [prior]), true);
});

t("distinct findings are not duplicates", () => {
  const prior = simhash(findingSignature({ title: "IDOR", asset: "https://api.acme.com/orders/1" }));
  const other = simhash(findingSignature({ title: "SSRF", asset: "https://acme.com/webhook" }));
  assert.strictEqual(isDuplicate(other, [prior]), false);
});

t("novelty: commodity class scores low, IDOR scores high", () => {
  const headers = assessNovelty({ title: "Missing security headers", asset: "https://acme.com/" });
  const idor = assessNovelty({ title: "IDOR exposes other users' orders", asset: "https://api.acme.com/orders/1", confirmed: true });
  assert.ok(headers.novelty < 30, `headers novelty ${headers.novelty}`);
  assert.ok(idor.novelty >= 90, `idor novelty ${idor.novelty}`);
});

t("novelty: a detected duplicate is heavily penalized + flagged", () => {
  const prior = simhash(findingSignature({ title: "SSRF", asset: "https://acme.com/webhook" }));
  const v = assessNovelty({ title: "SSRF", asset: "https://acme.com/webhook", confirmed: true }, [prior]);
  assert.strictEqual(v.duplicate, true);
  assert.ok(v.novelty < 30);
});

console.log(`\n${passed} passed`);
