// Run: npx tsx lib/voice-commands.test.ts
import {
  parseVoiceCommand,
  detectQuery,
  resolveFollowup,
  hasWakeWord,
  stripWake,
  type NavLink,
} from "./voice-commands";

let pass = 0,
  fail = 0;
function ok(c: boolean, msg: string) {
  if (c) pass++;
  else {
    fail++;
    console.error(`✗ ${msg}`);
  }
}

const LINKS: NavLink[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Findings", href: "/dashboard/findings" },
  { label: "Bug Bounty", href: "/dashboard/bugbounty" },
  { label: "Jobs", href: "/dashboard/jobs" },
  { label: "Machines", href: "/dashboard/runners" },
];

// ── Wake word ────────────────────────────────────────────────────────────────
ok(hasWakeWord("shiva open findings"), "wake: exact");
ok(hasWakeWord("hey siva what's up"), "wake: mishear 'siva'");
ok(!hasWakeWord("open findings"), "wake: absent");
ok(stripWake("hey shiva, go to jobs") === "go to jobs", "stripWake removes wake+hey");

// ── Navigation ────────────────────────────────────────────────────────────────
{
  const i = parseVoiceCommand("go to findings", LINKS);
  ok(i.type === "navigate" && i.href === "/dashboard/findings", "nav: findings");
}
{
  const i = parseVoiceCommand("take me to bug bounty", LINKS);
  ok(i.type === "navigate" && i.href === "/dashboard/bugbounty", "nav: bug bounty (multi-word alias)");
}

// ── Scan (asks to confirm) ────────────────────────────────────────────────────
{
  const i = parseVoiceCommand("scan example dot com", LINKS);
  ok(i.type === "ask" && i.pending.kind === "confirmScan" && i.pending.target === "example.com", "scan: reconstructs host + confirms");
}
{
  const yes = resolveFollowup({ kind: "confirmScan", target: "example.com" }, "yes go ahead", LINKS);
  ok(yes.type === "scan" && yes.target === "example.com", "scan: yes → scan intent");
}

// ── Status queries (the new 'seeing') ─────────────────────────────────────────
ok(detectQuery("what's running") === "jobs", "query: what's running → jobs");
ok(detectQuery("anything running right now") === "jobs", "query: anything running → jobs");
ok(detectQuery("how many jobs are queued") === "jobs", "query: how many jobs → jobs");
ok(detectQuery("are my machines online") === "runners", "query: machines online → runners");
ok(detectQuery("is my kali box up") === "runners", "query: kali up → runners");
ok(detectQuery("how many runners are connected") === "runners", "query: runners connected → runners");
ok(detectQuery("any critical findings") === "critical", "query: any critical → critical");
ok(detectQuery("how many critical vulnerabilities") === "critical", "query: critical count → critical");
ok(detectQuery("how many open findings do i have") === "findings", "query: open findings → findings");
ok(detectQuery("brief me") === "summary", "query: brief me → summary");
ok(detectQuery("give me a rundown") === "summary", "query: rundown → summary");
ok(detectQuery("what's going on") === "summary", "query: what's going on → summary");
ok(detectQuery("status") === "summary", "query: bare status → summary");

// Queries route through parseVoiceCommand as a 'query' intent.
{
  const i = parseVoiceCommand("how many critical findings", LINKS);
  ok(i.type === "query" && i.topic === "critical", "parse: critical query intent");
}
{
  const i = parseVoiceCommand("what's running", LINKS);
  ok(i.type === "query" && i.topic === "jobs", "parse: jobs query intent");
}

// ── Queries must NOT hijack navigation / scan ─────────────────────────────────
ok(detectQuery("go to findings") === null, "no false query: 'go to findings' is nav");
ok(detectQuery("scan example dot com") === null, "no false query: 'scan ...' is scan");
ok(detectQuery("show me the network map") === null, "no false query: 'show me ...' is nav");
{
  const i = parseVoiceCommand("go to findings", LINKS);
  ok(i.type === "navigate", "nav still wins over query for 'go to findings'");
}
{
  const i = parseVoiceCommand("show me findings", LINKS);
  ok(i.type === "navigate" && i.href === "/dashboard/findings", "'show me findings' still navigates");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
