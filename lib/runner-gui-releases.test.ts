// Verifies asset classification + release normalization for the desktop-app
// download flow. Run with `npm test` (tsx). No network — normalizeRelease is fed
// a canned GitHub API shape.

import assert from "node:assert";
import { classifyAsset, normalizeRelease, bestPerPlatform, compareVersions } from "./runner-gui-releases";

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok -", name);
}

const U = "https://example/download/";

t("windows: Setup .exe is the recommended installer", () => {
  const a = classifyAsset("RD-AISEC.Runner.Setup.1.0.3.exe", U + "s")!;
  assert.strictEqual(a.platform, "windows");
  assert.ok(/installer/.test(a.label));
  const portable = classifyAsset("RD-AISEC.Runner.1.0.3.exe", U + "p")!;
  assert.ok(a.weight > portable.weight, "setup outranks portable");
});

t("macOS: arm64 dmg = Apple Silicon, outranks Intel", () => {
  const arm = classifyAsset("RD-AISEC.Runner-1.0.3-arm64.dmg", U + "a")!;
  const intel = classifyAsset("RD-AISEC.Runner-1.0.3.dmg", U + "i")!;
  assert.strictEqual(arm.platform, "macos");
  assert.strictEqual(arm.arch, "arm64");
  assert.ok(/Apple Silicon/.test(arm.label));
  assert.ok(arm.weight > intel.weight, "apple silicon ranks first on M-series era");
});

t("linux: deb arm64 vs amd64 both classify", () => {
  const arm = classifyAsset("rdaisec-runner-gui_1.0.3_arm64.deb", U + "a")!;
  const amd = classifyAsset("rdaisec-runner-gui_1.0.3_amd64.deb", U + "b")!;
  assert.strictEqual(arm.arch, "arm64");
  assert.strictEqual(amd.arch, "x64");
  assert.ok(/arm64/.test(arm.label) && /amd64/.test(amd.label));
  const appimage = classifyAsset("RD-AISEC.Runner-1.0.3.AppImage", U + "c")!;
  assert.strictEqual(appimage.platform, "linux");
});

t("side-artifacts are skipped", () => {
  assert.strictEqual(classifyAsset("latest.yml", U + "y"), null);
  assert.strictEqual(classifyAsset("RD-AISEC.Runner-1.0.3.dmg.blockmap", U + "z"), null);
  assert.strictEqual(classifyAsset("checksums.txt", U + "w"), null);
});

t("normalizeRelease: sorts assets by weight, drops non-installers", () => {
  const r = normalizeRelease({
    tag_name: "runner-gui-v1.0.3",
    name: "RD-AISEC Runner v1.0.3",
    html_url: "https://gh/rel",
    published_at: "2026-08-13T09:00:00Z",
    draft: false,
    prerelease: false,
    assets: [
      { name: "latest.yml", browser_download_url: U + "yml", size: 10 },
      { name: "rdaisec-runner-gui_1.0.3_arm64.deb", browser_download_url: U + "deb", size: 70000000 },
      { name: "RD-AISEC.Runner.Setup.1.0.3.exe", browser_download_url: U + "exe", size: 78000000 },
    ],
  })!;
  assert.strictEqual(r.version, "runner-gui-v1.0.3");
  assert.strictEqual(r.assets.length, 2, "yml dropped");
  const grouped = bestPerPlatform(r);
  assert.strictEqual(grouped.windows.length, 1);
  assert.strictEqual(grouped.linux.length, 1);
});

t("compareVersions orders release tags", () => {
  assert.ok(compareVersions("runner-gui-v1.0.3", "runner-gui-v1.0.2") > 0);
  assert.ok(compareVersions("runner-gui-v1.0.0", "runner-gui-v1.1.0") < 0);
  assert.strictEqual(compareVersions("runner-gui-v1.0.3", "runner-gui-v1.0.3"), 0);
});

console.log(`\nrunner-gui-releases: ${passed} checks passed`);
