// Verifies the white-box hypothesis → dynamic-check mapping and the class parser.
// Run with `npm test` (tsx).

import assert from "node:assert";
import { checkForClass, hypothesisClassOf, isValidatableHypothesis } from "./hypothesis-validate";

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok -", name);
}

// The exact title shape lib/job-parser.ts emits for a source hypothesis.
const wb = (cls: string, file = "app/x.py", line = 42) => ({
  title: `[white-box] Possible ${cls} in ${file}:${line}`,
  description: `Source analysis flagged a potential ${cls} sink (hypothesis — not yet validated).`,
});

t("parses the class from a white-box title", () => {
  assert.strictEqual(hypothesisClassOf(wb("injection")), "injection");
  assert.strictEqual(hypothesisClassOf(wb("ssrf")), "ssrf");
  assert.strictEqual(hypothesisClassOf(wb("path-traversal")), "path-traversal");
  assert.strictEqual(hypothesisClassOf(wb("xss")), "xss");
  assert.strictEqual(hypothesisClassOf(wb("deserialization")), "deserialization");
  assert.strictEqual(hypothesisClassOf(wb("secrets")), "secrets");
  assert.strictEqual(hypothesisClassOf(wb("crypto")), "crypto");
  assert.strictEqual(hypothesisClassOf(wb("auth")), "auth");
  assert.strictEqual(hypothesisClassOf(wb("rce")), "rce");
});

t("non-white-box findings are not hypotheses", () => {
  assert.strictEqual(hypothesisClassOf({ title: "SQL injection on /login", description: "" }), null);
  assert.strictEqual(hypothesisClassOf({ title: "Open port 22", description: "" }), null);
  assert.strictEqual(isValidatableHypothesis({ title: "TLS 1.0 enabled", description: "" }), false);
});

t("each class maps to a concrete, non-destructive check with a filled target", () => {
  for (const cls of ["injection", "xss", "ssrf", "path-traversal", "rce", "deserialization", "auth", "secrets", "crypto"]) {
    const check = checkForClass(cls)!;
    assert.ok(check, `no check for ${cls}`);
    const target = check.mode === "url" ? "http://target.example" : "target.example";
    const args = check.args(target);
    assert.ok(check.tool.length > 0, `${cls} empty tool`);
    if (check.tool !== "sslscan") assert.ok(args.includes("target.example"), `${cls} target not filled into args`);
    assert.ok(check.proves.length > 0, `${cls} missing 'proves' note`);
  }
});

t("class → expected tool", () => {
  assert.strictEqual(checkForClass("injection")!.tool, "sqlmap");
  assert.strictEqual(checkForClass("xss")!.tool, "dalfox");
  assert.strictEqual(checkForClass("crypto")!.tool, "sslscan");
  assert.strictEqual(checkForClass("ssrf")!.tool, "nuclei");
});

t("crypto uses host mode; web classes use url mode", () => {
  assert.strictEqual(checkForClass("crypto")!.mode, "host");
  assert.strictEqual(checkForClass("injection")!.mode, "url");
});

t("aliases resolve (sqli→injection, lfi→path-traversal)", () => {
  assert.strictEqual(hypothesisClassOf(wb("sqli")), "injection");
  assert.strictEqual(hypothesisClassOf(wb("lfi")), "path-traversal");
});

t("unknown class → no check", () => {
  assert.strictEqual(checkForClass("teapot"), null);
  assert.strictEqual(checkForClass(null), null);
});

console.log(`\nhypothesis-validate: ${passed} checks passed`);
