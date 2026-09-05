// Tests the pure HackerOne report formatter. Run with `npm test` (tsx).

import assert from "node:assert";
import { buildHackerOneReport, h1Severity } from "./hackerone";

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok -", name);
}

t("h1Severity maps our severities to H1 vocabulary", () => {
  assert.strictEqual(h1Severity("critical"), "critical");
  assert.strictEqual(h1Severity("high"), "high");
  assert.strictEqual(h1Severity("medium"), "medium");
  assert.strictEqual(h1Severity("low"), "low");
  assert.strictEqual(h1Severity("info"), "none");
  assert.strictEqual(h1Severity("weird"), "none");
});

t("report has title, severity, and the core sections", () => {
  const r = buildHackerOneReport(
    { title: "Reflected XSS in search", severity: "high", description: "The q parameter is reflected unescaped.", recommendation: "Encode output." },
    { asset: "https://app.example.com/search" },
  );
  assert.strictEqual(r.severityRating, "high");
  assert.ok(r.title.includes("Reflected XSS"));
  for (const h of ["## Summary", "## Affected asset", "## Steps to reproduce", "## Impact", "## Remediation"]) {
    assert.ok(r.description.includes(h), `missing ${h}`);
  }
  assert.ok(r.description.includes("app.example.com/search"), "asset not embedded");
  assert.ok(r.description.includes("CWE-79"), "CWE hint for XSS missing");
});

t("title is capped at 255 chars", () => {
  const r = buildHackerOneReport({ title: "x".repeat(400), severity: "low" });
  assert.ok(r.title.length <= 255);
});

t("confirmed finding notes validation in PoC", () => {
  const r = buildHackerOneReport({ title: "SQLi", severity: "critical", confirmed: true });
  assert.ok(/validated during testing/i.test(r.description));
  assert.ok(r.description.includes("CWE-89"));
});

t("missing description/recommendation still produces a complete report", () => {
  const r = buildHackerOneReport({ title: "Open redirect", severity: "medium" });
  assert.ok(r.description.includes("## Remediation"));
  assert.ok(r.description.includes("CWE-601"));
});

console.log(`\n${passed} passed`);
