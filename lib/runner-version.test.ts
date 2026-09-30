// Guards that the portal's RUNNER_VERSION constant stays in lockstep with the
// version embedded in the served runner script (runner/rdaisec_runner.py).
//
// Why this matters: lib/runner-constants.ts RUNNER_VERSION only drives the
// "update available" banner and the `outdated` flag on the Machines page, while
// the script file is the real source of truth for self-update. If the constant
// lags behind the script, the portal flags an up-to-date runner as "outdated"
// and renders a nonsensical backwards "vNEW → vOLD" banner that a restart can
// never clear (the runner is already newer than what the portal calls latest).
// Run with `npm test`.

import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { RUNNER_VERSION } from "./runner-constants";

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok -", name);
}

function scriptVersion(): string {
  const p = path.join(__dirname, "..", "runner", "rdaisec_runner.py");
  const src = readFileSync(p, "utf8");
  const m = src.match(/^RUNNER_VERSION\s*=\s*["'](\d+(?:\.\d+)*)["']/m);
  assert.ok(m, "runner script must define RUNNER_VERSION = \"<n>\"");
  return m![1];
}

t("portal RUNNER_VERSION matches the served runner script", () => {
  const script = scriptVersion();
  assert.strictEqual(
    RUNNER_VERSION,
    script,
    `lib/runner-constants.ts RUNNER_VERSION (${RUNNER_VERSION}) must equal the ` +
      `version in runner/rdaisec_runner.py (${script}). Bump both together when ` +
      `you change the runner script, or the Machines page shows a false/backwards ` +
      `"update available" banner.`,
  );
});

t("both versions parse as an integer-dotted tuple", () => {
  // The runner compares versions as an integer tuple; a stray non-numeric tag
  // (e.g. "78-beta") would break that comparison and self-update.
  assert.ok(/^\d+(\.\d+)*$/.test(RUNNER_VERSION), "version must be digits/dots only");
});

console.log(`\n${passed} passed`);
