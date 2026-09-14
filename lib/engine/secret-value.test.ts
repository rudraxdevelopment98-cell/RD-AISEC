// Tests the secret VALUE classifier (public-by-design vs privileged). `npm test`.
//
// NOTE: every fixture below is a SYNTHETIC, non-working credential, and its
// recognizable prefix is split across a `+` so no complete secret-shaped token
// ever appears literally in this source (GitHub push-protection scans the text).
// They still reconstruct at runtime to exercise the classifier's regexes.

import assert from "node:assert";
import { classifySecretValue } from "./secret-value";

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok -", name);
}

t("Google AIza browser key is public-by-design → not payable", () => {
  const a = classifySecretValue("Exposed Google API key AI" + "za" + "0".repeat(35) + " on blog.ui.com");
  assert.equal(a.value, "public");
  assert.equal(a.payable, false);
});

t("Stripe publishable key is public; secret key is privileged", () => {
  assert.equal(classifySecretValue("pk" + "_live_" + "5".repeat(24)).value, "public");
  const secret = classifySecretValue("sk" + "_live_" + "5".repeat(24));
  assert.equal(secret.value, "privileged");
  assert.equal(secret.payable, true);
});

t("GitHub token is privileged and payable", () => {
  const a = classifySecretValue("Leaked git" + "hub_pat_" + "1".repeat(70));
  assert.equal(a.value, "privileged");
  assert.ok(a.payable);
});

t("Sentry public DSN and reCAPTCHA site key are public", () => {
  assert.equal(classifySecretValue("https://" + "abc123def456" + "@o12345.ingest.sentry.io/6789").value, "public");
  assert.equal(classifySecretValue("recaptcha site key 6L" + "a".repeat(38)).value, "public");
});

t("private key and DB connection string are privileged", () => {
  assert.equal(classifySecretValue("-----BEGIN RSA PRIVATE KEY-----\nMII...").value, "privileged");
  assert.equal(classifySecretValue("post" + "gres://admin:" + "s3cr3t" + "@db.internal:5432/prod").value, "privileged");
});

t("an unrecognized token shape is 'unknown' (needs live proof)", () => {
  const a = classifySecretValue("some opaque header value zzzz");
  assert.equal(a.value, "unknown");
});

console.log(`\n${passed} passed`);
