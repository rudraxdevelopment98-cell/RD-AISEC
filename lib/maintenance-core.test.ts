// Run: npx tsx lib/maintenance-core.test.ts
import {
  coerceStage,
  isActiveStage,
  parseMaintHeader,
  scheduleLabel,
  stageProgress,
  summarizeMaintenance,
} from "./maintenance-core";

let pass = 0;
let fail = 0;
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    console.error(`✗ ${msg}\n   expected ${e}\n   got      ${a}`);
  }
}
function ok(cond: boolean, msg: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${msg}`);
  }
}

// coerceStage
eq(coerceStage("upgrading"), "upgrading", "known stage");
eq(coerceStage("UPGRADING"), "upgrading", "case-insensitive");
eq(coerceStage("bogus"), "idle", "unknown → idle");
eq(coerceStage(null), "idle", "null → idle");

// isActiveStage
ok(isActiveStage("cleaning"), "cleaning is active");
ok(!isActiveStage("idle"), "idle not active");
ok(!isActiveStage("done"), "done not active");

// stageProgress
eq(stageProgress("idle"), 0, "idle 0%");
eq(stageProgress("done"), 100, "done 100%");
eq(stageProgress("failed"), 0, "failed 0%");
ok(stageProgress("starting") > 0 && stageProgress("starting") < stageProgress("reporting"), "monotonic-ish");
eq(stageProgress("reporting"), 100, "last pipeline step 100%");
eq(stageProgress("updating", 42), 42, "override honoured");
eq(stageProgress("updating", 999), stageProgress("updating"), "bad override ignored");

// parseMaintHeader
eq(parseMaintHeader(""), null, "empty header → null");
eq(parseMaintHeader("upgrading|60|Installing nuclei"), { stage: "upgrading", pct: 60, note: "Installing nuclei" }, "full header");
eq(parseMaintHeader("cleaning"), { stage: "cleaning", pct: null, note: "" }, "stage only");
eq(parseMaintHeader("done|100|"), { stage: "done", pct: 100, note: "" }, "done header");

// summarizeMaintenance
const now = Date.now();
const s1 = summarizeMaintenance(
  { maintStage: "cleaning", maintStartedAt: new Date(now - 60_000), maintUpdatedAt: new Date(now - 5_000) },
  now,
);
ok(s1.active && !s1.stale, "recent active cycle not stale");
ok(s1.elapsedMs != null && s1.elapsedMs >= 60_000, "elapsed tracked");

const s2 = summarizeMaintenance(
  { maintStage: "upgrading", maintStartedAt: new Date(now - 40 * 60_000), maintUpdatedAt: new Date(now - 20 * 60_000) },
  now,
);
ok(s2.stale, "long-silent active cycle is stale");

const s3 = summarizeMaintenance({ maintStage: "done", maintStartedAt: new Date(now - 300_000), maintUpdatedAt: new Date(now - 240_000) }, now);
ok(!s3.active && s3.progress === 100, "done summary");
eq(s3.elapsedMs, 60_000, "done elapsed = updated - started");

// scheduleLabel
eq(scheduleLabel(6, 8), "Daily 06:00–08:00", "schedule label");
eq(scheduleLabel(23, 1), "Daily 23:00–01:00", "wrap label");

console.log(`\nmaintenance-core: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
