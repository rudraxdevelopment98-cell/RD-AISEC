// Tests the pure exploit-validator core (P1 proof gate). Run with `npm test` (tsx).

import assert from "node:assert";
import { validatableClass, validationJobFor, parseValidationProof } from "./validators";

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok -", name);
}

t("validatableClass maps by keyword, most-specific first", () => {
  assert.strictEqual(validatableClass({ title: "Reflected XSS in search" }), "xss");
  assert.strictEqual(validatableClass({ title: "Blind SSRF via webhook" }), "ssrf");
  assert.strictEqual(validatableClass({ title: "SSTI in name field" }), "ssti");
  assert.strictEqual(validatableClass({ category: "sqli", title: "Injection" }), "sqli");
  assert.strictEqual(validatableClass({ title: "Open redirect on /go" }), "redirect");
  assert.strictEqual(validatableClass({ title: "Missing security headers" }), null);
});

t("validationJobFor picks the right proof tool + method per class", () => {
  assert.deepStrictEqual(validationJobFor("xss", "u")?.tool, "dalfox");
  assert.strictEqual(validationJobFor("xss", "u")?.method, "headless-execution");
  assert.strictEqual(validationJobFor("ssrf", "u")?.tool, "nuclei");
  assert.strictEqual(validationJobFor("ssrf", "u")?.method, "oast-callback");
  assert.strictEqual(validationJobFor("sqli", "u")?.tool, "sqlmap");
  assert.strictEqual(validationJobFor("sqli", "u")?.method, "differential");
});

t("dalfox: [V] verified → proven (headless execution)", () => {
  const p = parseValidationProof("dalfox", "[V] Triggered XSS Payload on https://x/?q= param=q\ndone");
  assert.strictEqual(p.proven, true);
  assert.strictEqual(p.method, "headless-execution");
});

t("dalfox: reflection only (no [V]) → NOT proven", () => {
  const p = parseValidationProof("dalfox", "[R] reflected value found on param q");
  assert.strictEqual(p.proven, false);
});

t("nuclei: interactsh OOB interaction → proven (oast)", () => {
  const p = parseValidationProof("nuclei", "[blind-ssrf-interactsh] [http] [high] https://t/api\nInteractsh interaction (dns) received");
  assert.strictEqual(p.proven, true);
  assert.strictEqual(p.method, "oast-callback");
});

t("nuclei: no interaction → NOT proven", () => {
  const p = parseValidationProof("nuclei", "no results found");
  assert.strictEqual(p.proven, false);
});

t("sqlmap: confirmed injection → proven (differential)", () => {
  const p = parseValidationProof("sqlmap", "sqlmap identified the following injection point:\nParameter 'id' is vulnerable.");
  assert.strictEqual(p.proven, true);
  assert.strictEqual(p.method, "differential");
});

t("sqlmap: not confirmed → NOT proven", () => {
  const p = parseValidationProof("sqlmap", "all tested parameters do not appear to be injectable");
  assert.strictEqual(p.proven, false);
});

t("secret class → runner-native secretvalidate", () => {
  assert.strictEqual(validatableClass({ title: "Exposed AWS key in bundle" }), "secret");
  assert.strictEqual(validationJobFor("secret", "u")?.tool, "secretvalidate");
});

t("secretvalidate: a live credential → proven; placeholder/revoked → not", () => {
  const live = parseValidationProof("secretvalidate", "github live=true who=octocat key=…ab12");
  assert.strictEqual(live.proven, true);
  const dead = parseValidationProof("secretvalidate", "github live=false who=- key=…ab12");
  assert.strictEqual(dead.proven, false);
});

t("unknown tool → never proven", () => {
  assert.strictEqual(parseValidationProof("nikto", "OSVDB stuff").proven, false);
});

console.log(`\n${passed} passed`);
