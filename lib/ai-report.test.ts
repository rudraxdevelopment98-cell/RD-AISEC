// Tests the report exec-summary: recon inventory must NOT headline the report,
// and real (confirmed) findings must. Run with `npm test`.

import assert from "node:assert";
import { buildExecutiveSummary, isReconArtifact } from "./ai-report";

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok -", name);
}

const base = {
  id: "e1", name: "Test", type: "pentest", client: "Acme", scope: "*.acme.com",
  authorized: true, status: "active", createdAt: new Date(), updatedAt: new Date(),
} as any;

function eng(findings: any[]) {
  return { ...base, findings } as any;
}

t("recon inventory titles are recognized as artifacts", () => {
  assert.ok(isReconArtifact({ title: "gau URLs on ispdesign.ui.com (1014)" }));
  assert.ok(isReconArtifact({ title: "katana URLs on x.com (322)" }));
  assert.ok(isReconArtifact({ title: "Hidden parameters discovered: /api" }));
  assert.ok(!isReconArtifact({ title: "IDOR / BOLA on /api/orders" }));
  assert.ok(!isReconArtifact({ title: "Exposed GitHub token on app.js" }));
});

t("a report of only recon artifacts does NOT rate High and has no recon key-risks", () => {
  const s = buildExecutiveSummary(eng([
    { title: "gau URLs on a.com (1014)", severity: "high", status: "open", confirmed: false, recommendation: "Review endpoints." },
    { title: "katana URLs on b.com (500)", severity: "high", status: "open", confirmed: false, recommendation: "Review endpoints." },
  ]));
  assert.notStrictEqual(s.rating, "High", "recon-only must not rate High");
  assert.notStrictEqual(s.rating, "Critical");
  assert.strictEqual(s.keyRisks.length, 0, "no recon items in key risks");
});

t("real findings headline; confirmed comes first", () => {
  const s = buildExecutiveSummary(eng([
    { title: "gau URLs on a.com (900)", severity: "high", status: "open", confirmed: false, recommendation: "x" },
    { title: "Reflected XSS on /search", severity: "medium", status: "open", confirmed: false, recommendation: "Encode output." },
    { title: "IDOR on /api/orders", severity: "high", status: "open", confirmed: true, recommendation: "Enforce authz." },
  ]));
  assert.ok(s.keyRisks.length >= 2);
  assert.ok(/IDOR/.test(s.keyRisks[0].title), "confirmed IDOR leads");
  assert.ok(!s.keyRisks.some((r) => /URLs on/.test(r.title)), "no recon in key risks");
  assert.ok(s.rating === "High" || s.rating === "Critical");
});

console.log(`\n${passed} passed`);
