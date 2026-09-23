// Tests the value-aware severity in parseSecrets (accuracy): a public-by-design
// key must NOT ride in as high-severity noise, while a privileged one keeps its
// severity. Run with `npm test` (tsx).

import assert from "node:assert";
import { parseSecrets } from "./job-parser";

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok -", name);
}

// Synthetic keys; prefixes split so no complete secret-shaped token sits in
// source, and no placeholder substring (e.g. "0000000") that the parser skips.
const AIZA = "AI" + "za" + "bC3".repeat(12).slice(0, 35); // Google browser key (public)
const GHTOK = "gh" + "p_" + "bCd3fG".repeat(6);           // GitHub token (privileged)

t("public Google AIza key is downgraded to low + flagged public-by-design", () => {
  const f = parseSecrets("https://blog.example.com/app.js", `var k="${AIZA}";`);
  assert.strictEqual(f.length, 1, "one secret finding");
  assert.strictEqual(f[0].severity, "low", `severity ${f[0].severity}`);
  assert.ok(/public-by-design/i.test(f[0].title), "title notes public-by-design");
  assert.strictEqual(f[0].confirmed, false);
});

t("privileged GitHub token keeps its high (critical) severity", () => {
  const f = parseSecrets("https://app.example.com/main.js", `token: "${GHTOK}"`);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].severity, "critical", `severity ${f[0].severity}`);
  assert.ok(!/public-by-design/i.test(f[0].title));
});

t("no secret → no finding; placeholder → skipped", () => {
  assert.strictEqual(parseSecrets("https://x.com", "nothing here").length, 0);
  assert.strictEqual(parseSecrets("https://x.com", "AIzaEXAMPLE_YOUR_KEY_HERE_PLACEHOLDER0").length, 0);
});

t("newly-covered providers are detected at high/critical", () => {
  const gitlab = parseSecrets("https://app.example.com/main.js", "glpat-" + "aB3dE5fG7hJ9kL1mN3pQ");
  assert.strictEqual(gitlab.length, 1, "GitLab token detected");
  assert.strictEqual(gitlab[0].severity, "critical");

  const digitalocean = parseSecrets("https://x.com/a.js", "dop_v1_" + "0f1e2d3c4b5a69788796a5b4c3d2e1f0".repeat(2));
  assert.strictEqual(digitalocean.length, 1, "DigitalOcean token detected");
  assert.strictEqual(digitalocean[0].severity, "critical");

  const npmtok = parseSecrets("https://x.com/a.js", "npm_" + "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8");
  assert.strictEqual(npmtok.length, 1, "npm token detected");
  assert.strictEqual(npmtok[0].severity, "high");
});

console.log(`\n${passed} passed`);
