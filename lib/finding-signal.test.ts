// Run: npx tsx lib/finding-signal.test.ts
import { signalScore, bySignalDesc } from "./finding-signal";

let pass = 0, fail = 0;
function ok(c: boolean, msg: string) { if (c) pass++; else { fail++; console.error(`✗ ${msg}`); } }

// Persisted risk is the single ranking authority: tier derives from it.
ok(signalScore({ severity: "low", status: "open", risk: 82 }).tier === "priority", "risk 82 → priority (even if severity low)");
ok(signalScore({ severity: "high", status: "open", risk: 45 }).tier === "review", "risk 45 → review");
ok(signalScore({ severity: "critical", status: "open", risk: 20 }).tier === "low", "risk 20 → low (even if severity critical)");
ok(signalScore({ severity: "high", status: "open", risk: 5 }).tier === "noise", "risk 5 → noise");
ok(signalScore({ severity: "high", status: "open", risk: 82 }).score === 82, "score == risk when risk present");

// Resolved findings sink even with a high risk score.
{
  const t = signalScore({ severity: "critical", status: "fixed", risk: 90 }).tier;
  ok(t === "low" || t === "review", "fixed high-risk finding sinks below open");
}

// False positive is always noise, even with a high risk score.
ok(signalScore({ severity: "critical", status: "false_positive", risk: 90 }).tier === "noise", "false_positive → noise");

// Fallback: no persisted risk → heuristic still works (proven critical → priority).
{
  const r = signalScore({ severity: "critical", status: "open", confidence: "proven" });
  ok(r.tier === "priority", "no risk → heuristic ranks proven critical as priority");
}
{
  const r = signalScore({ severity: "info", status: "open", title: "Missing security header" });
  ok(r.tier === "noise" || r.tier === "low", "no risk → header noise stays low/noise");
}

// Sort: higher risk first.
{
  const a = { severity: "low", status: "open", risk: 90 };
  const b = { severity: "critical", status: "open", risk: 40 };
  ok(bySignalDesc(a, b) < 0, "bySignalDesc ranks higher risk first");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
