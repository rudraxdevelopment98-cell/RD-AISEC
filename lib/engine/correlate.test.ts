// Tests the deterministic correlation engine (TKB brain). Run with `npm test`.

import assert from "node:assert";
import { correlate, type Fact } from "./correlate";

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok -", name);
}

t("dangling-CNAME subdomain → high-priority takeover lead", () => {
  const facts: Fact[] = [
    { kind: "subdomain", host: "dead.acme.com", cname: "acme-old.s3.amazonaws.com", alive: false },
    { kind: "subdomain", host: "live.acme.com", cname: "acme.herokuapp.com", alive: true }, // alive → no lead
  ];
  const { leads } = correlate(facts);
  const takeover = leads.filter((l) => l.cls === "takeover");
  assert.strictEqual(takeover.length, 1, "only the dead one is a takeover lead");
  assert.ok(takeover[0].target === "dead.acme.com" && takeover[0].priority >= 90);
});

t("object-id param reused across endpoints → IDOR lead", () => {
  const facts: Fact[] = [
    { kind: "endpoint", url: "https://api.acme.com/orders?id=1" },
    { kind: "endpoint", url: "https://api.acme.com/invoices?id=9" },
  ];
  const { leads } = correlate(facts);
  const idor = leads.find((l) => l.cls === "idor");
  assert.ok(idor, "IDOR lead produced");
  assert.ok(idor!.priority >= 80);
});

t("a single object-id endpoint does NOT (yet) raise an IDOR reuse lead", () => {
  const { leads } = correlate([{ kind: "endpoint", url: "https://acme.com/x?id=1" }]);
  assert.ok(!leads.some((l) => l.cls === "idor"), "reuse needs >= 2 endpoints");
});

t("dictionary params ending in 'id' (valid/paid/grid) are NOT treated as object ids", () => {
  const { leads } = correlate([
    { kind: "endpoint", url: "https://acme.com/a?valid=1" },
    { kind: "endpoint", url: "https://acme.com/b?paid=1" },
    { kind: "endpoint", url: "https://acme.com/c?grid=1" },
  ]);
  assert.ok(!leads.some((l) => l.cls === "idor"), "valid/paid/grid must not raise IDOR");
});

t("concatenated entity ids (orderid, userId) still raise an IDOR reuse lead", () => {
  const { leads } = correlate([
    { kind: "endpoint", url: "https://api.acme.com/a?orderid=1" },
    { kind: "endpoint", url: "https://api.acme.com/b?orderid=9" },
  ]);
  assert.ok(leads.some((l) => l.cls === "idor"), "orderid is an object reference");
});

t("SSRF/redirect and LFI params raise their own leads", () => {
  const { leads } = correlate([
    { kind: "endpoint", url: "https://acme.com/proxy?url=http://x" },
    { kind: "endpoint", url: "https://acme.com/view?file=a.txt" },
  ]);
  assert.ok(leads.some((l) => l.cls === "ssrf"));
  assert.ok(leads.some((l) => l.cls === "lfi"));
});

t("tech stack drives class-specific leads (GraphQL)", () => {
  const { leads } = correlate([{ kind: "tech", host: "api.acme.com", name: "GraphQL" }]);
  assert.ok(leads.some((l) => l.cls === "graphql" && l.target === "api.acme.com"));
});

t("3+ findings on one host → attack-chain lead; leads are ranked best-first", () => {
  const facts: Fact[] = [
    { kind: "finding", host: "acme.com", cls: "xss", title: "x" },
    { kind: "finding", host: "acme.com", cls: "idor", title: "y" },
    { kind: "finding", host: "acme.com", cls: "ssrf", title: "z" },
    { kind: "subdomain", host: "dead.acme.com", cname: "x.github.io", alive: false },
  ];
  const { leads } = correlate(facts);
  assert.ok(leads.some((l) => l.cls === "chain"));
  // Takeover (95) should outrank the chain lead → first.
  assert.strictEqual(leads[0].cls, "takeover");
});

t("empty facts → no leads, no throw", () => {
  const { relations, leads } = correlate([]);
  assert.strictEqual(relations.length, 0);
  assert.strictEqual(leads.length, 0);
});

console.log(`\n${passed} passed`);
