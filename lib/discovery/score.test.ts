// Tests the pure program-scoring/ranking. Run with `npm test` (tsx).

import assert from "node:assert";
import { scoreProgram, rankPrograms } from "./score";

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok -", name);
}

const NOW = Date.parse("2026-09-09T00:00:00Z");

t("a paying, open-scope, safe-harbour program scores high", () => {
  const s = scoreProgram(
    {
      handle: "acme",
      name: "Acme",
      submission_state: "open",
      offers_bounties: true,
      open_scope: true,
      gold_standard_safe_harbor: true,
      triage_active: true,
      started_accepting_at: "2026-08-01T00:00:00Z",
    },
    NOW,
  );
  assert.ok(s.score >= 90, `expected high, got ${s.score}`);
  assert.ok(s.eligible);
  assert.ok(s.reasons.includes("pays bounties"));
});

t("a VDP-only, closed program scores low and is ineligible", () => {
  const s = scoreProgram({ handle: "vdp", submission_state: "paused", offers_bounties: false }, NOW);
  assert.strictEqual(s.eligible, false);
  assert.ok(s.score < 20, `expected low, got ${s.score}`);
});

t("freshness helps: newer beats older, all else equal", () => {
  const base = { handle: "x", submission_state: "open", offers_bounties: true };
  const fresh = scoreProgram({ ...base, started_accepting_at: "2026-08-01T00:00:00Z" }, NOW);
  const old = scoreProgram({ ...base, started_accepting_at: "2022-01-01T00:00:00Z" }, NOW);
  assert.ok(fresh.score > old.score);
});

t("ranking puts eligible + higher score first", () => {
  const ranked = rankPrograms(
    [
      { handle: "closed-rich", submission_state: "paused", offers_bounties: true, open_scope: true },
      { handle: "open-poor", submission_state: "open", offers_bounties: false },
      { handle: "open-rich", submission_state: "open", offers_bounties: true, open_scope: true },
    ],
    NOW,
  );
  assert.strictEqual(ranked[0].handle, "open-rich");
  assert.strictEqual(ranked[ranked.length - 1].handle, "closed-rich");
});

t("programs without a handle are dropped", () => {
  const ranked = rankPrograms([{ name: "no handle" }, { handle: "ok", submission_state: "open" }], NOW);
  assert.strictEqual(ranked.length, 1);
  assert.strictEqual(ranked[0].handle, "ok");
});

console.log(`\n${passed} passed`);
