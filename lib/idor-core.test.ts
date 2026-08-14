// Tests the IDOR/BOLA differential decision core. Run with `npm test` (tsx).

import assert from "node:assert";
import { assessAccess, objectRef, prioritizeForIdor, type AccessProbe } from "./idor-core";

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok -", name);
}

const ok = (len: number, body?: string, ct = "application/json"): { status: number; bodyLen: number; body?: string; contentType: string } =>
  ({ status: 200, bodyLen: len, body, contentType: ct });

t("marker in attacker body → confirmed BOLA, critical", () => {
  const p: AccessProbe = {
    endpoint: "GET /api/orders/1001",
    owner: ok(500, '{"id":1001,"email":"alice@example.com"}'),
    attacker: ok(500, '{"id":1001,"email":"alice@example.com"}'),
    ownerMarker: "alice@example.com",
  };
  const v = assessAccess(p);
  assert.strictEqual(v.verdict, "bola");
  assert.strictEqual(v.severity, "critical");
  assert.ok(v.confidence >= 90);
});

t("same-shape 200 from account B without marker → BOLA suspected/high (not critical)", () => {
  const p: AccessProbe = {
    endpoint: "GET /api/orders/1001",
    owner: ok(500),
    attacker: ok(520),
  };
  const v = assessAccess(p);
  assert.strictEqual(v.verdict, "bola");
  assert.ok(["high", "critical"].includes(v.severity));
  assert.ok(v.confidence < 90, "no marker → not marker-level confidence");
});

t("sensitive path bumps same-shape BOLA to critical", () => {
  const v = assessAccess({ endpoint: "GET /api/invoice/44", owner: ok(800), attacker: ok(820) });
  assert.strictEqual(v.severity, "critical");
});

t("account B denied (403) → safe", () => {
  const v = assessAccess({ endpoint: "GET /api/orders/1001", owner: ok(500), attacker: { status: 403, bodyLen: 20 } });
  assert.strictEqual(v.verdict, "safe");
});

t("account B 404 → safe (object hidden)", () => {
  const v = assessAccess({ endpoint: "GET /api/orders/1001", owner: ok(500), attacker: { status: 404, bodyLen: 15 } });
  assert.strictEqual(v.verdict, "safe");
});

t("attacker 200 but very different size → inconclusive (likely B's own object)", () => {
  const v = assessAccess({ endpoint: "GET /api/orders/1001", owner: ok(5000), attacker: ok(120) });
  assert.strictEqual(v.verdict, "inconclusive");
  assert.strictEqual(v.severity, "medium");
});

t("no owner baseline → inconclusive, low confidence", () => {
  const v = assessAccess({ endpoint: "GET /api/orders/1001", owner: { status: 404, bodyLen: 0 }, attacker: ok(500) });
  assert.strictEqual(v.verdict, "inconclusive");
  assert.ok(v.confidence <= 15);
});

t("anonymous access with marker → unauth critical", () => {
  const v = assessAccess({
    endpoint: "GET /api/orders/1001",
    owner: ok(500, '{"email":"alice@example.com"}'),
    attacker: { status: 403, bodyLen: 10 },
    anon: ok(500, '{"email":"alice@example.com"}'),
    ownerMarker: "alice@example.com",
  });
  assert.strictEqual(v.verdict, "unauth");
  assert.strictEqual(v.severity, "critical");
});

t("anonymous same-shape success → unauth high", () => {
  const v = assessAccess({
    endpoint: "GET /api/profile/7",
    owner: ok(300),
    attacker: { status: 401, bodyLen: 10 },
    anon: ok(310),
  });
  assert.strictEqual(v.verdict, "unauth");
  assert.ok(["high", "critical"].includes(v.severity));
});

// ── object reference classification ─────────────────────────────────────────
t("numeric id is enumerable", () => {
  const r = objectRef("GET /api/orders/1001");
  assert.strictEqual(r.kind, "numeric");
  assert.strictEqual(r.value, "1001");
  assert.strictEqual(r.enumerable, true);
});

t("uuid is not enumerable", () => {
  const r = objectRef("GET /api/orders/550e8400-e29b-41d4-a716-446655440000");
  assert.strictEqual(r.kind, "uuid");
  assert.strictEqual(r.enumerable, false);
});

t("no id ref → kind none", () => {
  assert.strictEqual(objectRef("GET /api/health").kind, "none");
});

t("prioritize: enumerable + sensitive first, non-id dropped", () => {
  const ranked = prioritizeForIdor([
    { endpoint: "GET /api/health" }, // no id → dropped
    { endpoint: "GET /api/avatar/9" }, // numeric, not sensitive
    { endpoint: "GET /api/invoice/44" }, // numeric + sensitive → top
    { endpoint: "GET /api/doc/550e8400-e29b-41d4-a716-446655440000" }, // uuid + sensitive
  ]);
  assert.strictEqual(ranked.length, 3, "non-id endpoint dropped");
  assert.strictEqual(ranked[0].endpoint, "GET /api/invoice/44", "enumerable+sensitive ranks first");
});

console.log(`\nidor-core: ${passed} checks passed`);
