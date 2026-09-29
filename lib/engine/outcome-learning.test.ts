// Tests the pure outcome-learning core. Run with `npm test`.

import assert from "node:assert";
import { bucketOutcome, learnFromOutcomes, applyOutcomeAdjustment, type OutcomeRow } from "./outcome-learning";

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok -", name);
}

t("HackerOne states map to the right outcome buckets", () => {
  assert.strictEqual(bucketOutcome("resolved"), "resolved");
  assert.strictEqual(bucketOutcome("triaged"), "triaged");
  assert.strictEqual(bucketOutcome("Duplicate"), "duplicate");
  assert.strictEqual(bucketOutcome("not_applicable"), "not-applicable");
  assert.strictEqual(bucketOutcome("new"), "pending");
  assert.strictEqual(bucketOutcome("needs-more-info"), "pending");
});

t("a class that keeps paying gets boosted; one that keeps failing gets demoted", () => {
  const rows: OutcomeRow[] = [
    ...Array(4).fill(0).map(() => ({ cls: "idor", outcome: "resolved" as const, bountyAmount: 500 })),
    ...Array(4).fill(0).map(() => ({ cls: "headers", outcome: "informative" as const })),
  ];
  const model = learnFromOutcomes(rows);
  assert.ok(model.byClass.idor.adjust > 1, `idor adjust ${model.byClass.idor.adjust}`);
  assert.ok(model.byClass.headers.adjust < 1, `headers adjust ${model.byClass.headers.adjust}`);
  // Applied to a base score: idor boosted, headers demoted.
  assert.ok(applyOutcomeAdjustment(80, "idor", model) >= 80);
  assert.ok(applyOutcomeAdjustment(80, "headers", model) < 80);
});

t("below the min-decided threshold, no adjustment (adjust = 1)", () => {
  const model = learnFromOutcomes([{ cls: "ssrf", outcome: "resolved" }]); // 1 < 3
  assert.strictEqual(model.byClass.ssrf.adjust, 1);
  assert.strictEqual(applyOutcomeAdjustment(70, "ssrf", model), 70);
});

t("pending outcomes don't count as wins or losses", () => {
  const model = learnFromOutcomes([
    { cls: "xss", outcome: "pending" }, { cls: "xss", outcome: "pending" }, { cls: "xss", outcome: "pending" },
  ]);
  assert.strictEqual(model.byClass.xss.decided, 0);
  assert.strictEqual(model.byClass.xss.adjust, 1);
});

t("unknown class + no model → base score unchanged", () => {
  assert.strictEqual(applyOutcomeAdjustment(60, "whatever", null), 60);
  assert.strictEqual(applyOutcomeAdjustment(60, "whatever", learnFromOutcomes([])), 60);
});

console.log(`\n${passed} passed`);
