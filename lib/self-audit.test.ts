// Tests the pure helpers of self-audit. Run with `npm test` (tsx).

import assert from "node:assert";
import { cveList, auditScoreFromItems, type AuditItem } from "./self-audit";

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok -", name);
}

t("cveList extracts distinct, upper-cased CVE ids", () => {
  const got = cveList("Affected by cve-2024-1234 and CVE-2023-99999; also CVE-2024-1234 again");
  assert.deepStrictEqual(got.sort(), ["CVE-2023-99999", "CVE-2024-1234"]);
});

t("cveList returns [] when there are none", () => {
  assert.deepStrictEqual(cveList("no cves here"), []);
});

t("auditScoreFromItems penalises gaps more than warns", () => {
  const items: AuditItem[] = [
    { level: "gap", title: "a", detail: "" },
    { level: "warn", title: "b", detail: "" },
    { level: "ok", title: "c", detail: "" },
  ];
  assert.strictEqual(auditScoreFromItems(items), 100 - 15 - 6);
});

t("auditScoreFromItems clamps at 0 and 100", () => {
  assert.strictEqual(auditScoreFromItems([]), 100);
  const many: AuditItem[] = Array.from({ length: 20 }, () => ({ level: "gap" as const, title: "x", detail: "" }));
  assert.strictEqual(auditScoreFromItems(many), 0);
});

console.log(`\n${passed} passed`);
