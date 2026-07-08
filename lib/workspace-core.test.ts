// Run: npx tsx lib/workspace-core.test.ts
import {
  buildTimeline,
  fmtElapsed,
  filterTasks,
  severityRank,
  tabCounts,
  taskMatchesTab,
  workspaceMetrics,
  type WsTask,
  type WorkspaceData,
} from "./workspace-core";

let pass = 0;
let fail = 0;
function eq(a: unknown, e: unknown, msg: string) {
  if (JSON.stringify(a) === JSON.stringify(e)) pass++;
  else {
    fail++;
    console.error(`✗ ${msg}\n   expected ${JSON.stringify(e)}\n   got      ${JSON.stringify(a)}`);
  }
}
function ok(c: boolean, msg: string) {
  if (c) pass++;
  else {
    fail++;
    console.error(`✗ ${msg}`);
  }
}

function task(over: Partial<WsTask>): WsTask {
  return {
    id: "t", tool: "nmap", target: "example.com", args: "", status: "done", stage: "",
    engagementId: "e1", engagementName: "Acme", runnerName: "kali", queuedBy: "me@x",
    priority: 0, retries: 0, exitCode: 0, output: "", findingsCount: 0, needsReview: false,
    createdAt: 1000, startedAt: 2000, finishedAt: 5000, ...over,
  };
}

// taskMatchesTab
ok(taskMatchesTab(task({ status: "running" }), "Running"), "running → Running");
ok(taskMatchesTab(task({ status: "queued" }), "Running"), "queued → Running");
ok(taskMatchesTab(task({ status: "done" }), "Completed"), "done → Completed");
ok(taskMatchesTab(task({ status: "failed" }), "Failed"), "failed → Failed");
ok(taskMatchesTab(task({ status: "canceled" }), "Failed"), "canceled → Failed");
ok(!taskMatchesTab(task({ status: "done", needsReview: false }), "Needs review"), "done w/o review not needs-review");
ok(taskMatchesTab(task({ status: "done", needsReview: true }), "Needs review"), "done w/ review → Needs review");
ok(taskMatchesTab(task({}), "All"), "everything → All");

// filterTasks query
const tasks = [
  task({ id: "a", tool: "nmap", target: "a.com", status: "running" }),
  task({ id: "b", tool: "nuclei", target: "b.com", status: "done" }),
  task({ id: "c", tool: "httpx", target: "b.com", engagementName: "Beta", status: "failed" }),
];
eq(filterTasks(tasks, "All", "nuclei").map((t) => t.id), ["b"], "query by tool");
eq(filterTasks(tasks, "All", "b.com").map((t) => t.id), ["b", "c"], "query by target");
eq(filterTasks(tasks, "Failed", "").map((t) => t.id), ["c"], "tab filter");

// tabCounts
const tc = tabCounts(tasks);
eq(tc.All, 3, "All count");
eq(tc.Running, 1, "Running count");
eq(tc.Completed, 1, "Completed count");
eq(tc.Failed, 1, "Failed count");

// buildTimeline
const done = buildTimeline(task({ status: "done", findingsCount: 2, needsReview: true }));
ok(done.some((s) => s.key === "findings" && s.state === "active"), "findings step active when needs review");
eq(done.find((s) => s.key === "finish")?.state, "done", "finish done");
const failed = buildTimeline(task({ status: "failed", exitCode: 1, finishedAt: 9000 }));
eq(failed.find((s) => s.key === "execute")?.state, "failed", "execute failed");
const running = buildTimeline(task({ status: "running", finishedAt: null, exitCode: null }));
eq(running.find((s) => s.key === "execute")?.state, "active", "execute active while running");

// severityRank ordering
ok(severityRank("critical") < severityRank("high"), "critical outranks high");
ok(severityRank("high") < severityRank("info"), "high outranks info");

// fmtElapsed
eq(fmtElapsed(0, 5000), "5s", "5s");
eq(fmtElapsed(0, 65000), "1m 5s", "1m 5s");
eq(fmtElapsed(null, null), "—", "no start");

// workspaceMetrics
const data: WorkspaceData = {
  projects: [{ id: "p", name: "P", client: "", type: "pentest", status: "active", scope: "", taskCount: 3, findingCount: 1 }],
  tasks: [task({ status: "running" }), task({ status: "done", needsReview: true })],
  findings: [],
};
const m = workspaceMetrics(data);
eq(m.find((x) => x.label === "Active tasks")?.value, 1, "active tasks metric");
eq(m.find((x) => x.label === "Needs review")?.value, 1, "needs review metric");
eq(m.find((x) => x.label === "Projects")?.value, 1, "projects metric");

console.log(`\nworkspace-core: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
