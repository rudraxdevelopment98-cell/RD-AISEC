// Run: npx tsx lib/engine/engine.test.ts
import { cvssFor, exposureOf, prioritize, riskSummary, scoreFinding, tierFor } from "./risk-core";
import { remediationPlan } from "./remediation-core";
import { attackChains, buildEngineIntel, enrich, type EngineFinding } from "./engine-core";

let pass = 0, fail = 0;
function ok(c: boolean, msg: string) { if (c) pass++; else { fail++; console.error(`✗ ${msg}`); } }
function eq(a: unknown, b: unknown, msg: string) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x === y) pass++; else { fail++; console.error(`✗ ${msg}\n   exp ${y}\n   got ${x}`); } }

// ── risk-core ────────────────────────────────────────────────────────────────
// CVSS derivation: explicit vector wins.
ok(cvssFor({ title: "Issue", description: "CVSS:3.1/AV:N/AC:L score 9.8", severity: "low" }) === 9.8, "explicit CVSS wins");
// class band midpoint when no explicit score (SQLi class ~ high band).
ok(cvssFor({ title: "SQL injection in id param", severity: "medium" }) >= 8, "sqli class → high cvss");
// severity fallback.
ok(cvssFor({ title: "Some misc thing", severity: "low" }) === 2.5, "severity fallback");

// exposure
eq(exposureOf({ title: "Login bypass", description: "reachable at https://app.example.com without login", severity: "high" }), "unauthenticated", "unauth exposure");
eq(exposureOf({ title: "x", description: "on internal 10.0.0.5", severity: "low" }), "internal", "internal exposure");

// scoring: proven + KEV + internet critical → P1, ~100
const worst = scoreFinding({ title: "RCE via upload", description: "exploited in the wild at https://x.com, no auth", severity: "critical", confirmed: true });
ok(worst.score >= 90, "worst-case near 100");
eq(worst.tier, "P1", "worst-case P1");
ok(worst.knownExploited, "KEV detected from text");
ok(worst.factors.length >= 3, "multiple factors");

// benign info floors low
const benign = scoreFinding({ title: "Informational banner", severity: "info" });
ok(benign.score < 20, "info floors low");
eq(benign.tier, "P4", "info → P4");

// false positive zeroes out
ok(scoreFinding({ title: "SQLi", severity: "critical", status: "false_positive" }).score === 0, "FP → 0");
// fixed drops hard
ok(scoreFinding({ title: "SQLi", severity: "critical", status: "fixed" }).score < scoreFinding({ title: "SQLi", severity: "critical" }).score, "fixed lowers score");

// EPSS raises score
const noEpss = scoreFinding({ title: "Outdated nginx", severity: "medium" }).score;
const hiEpss = scoreFinding({ title: "Outdated nginx", severity: "medium", epss: 0.9 }).score;
ok(hiEpss > noEpss, "EPSS raises score");

// tier overrides
eq(tierFor(65, { kev: true, confirmed: true, sev: "critical" }), "P1", "kev critical → P1 override");
eq(tierFor(65, { kev: false, confirmed: false, sev: "high" }), "P2", "65 → P2");

// prioritize sorts desc + honors epss map by CVE
const list: EngineFinding[] = [
  { id: "a", title: "Low info note", description: "", severity: "info" },
  { id: "b", title: "SQL injection", description: "CVE-2021-1234 at https://x.com", severity: "critical", confirmed: true },
  { id: "c", title: "Missing security headers", description: "", severity: "low" },
];
const pr = prioritize(list, new Map([["CVE-2021-1234", 0.7]]));
eq(pr[0].id, "b", "highest risk first");
ok((pr[0] as { risk: { epss: number | null } }).risk.epss === 0.7, "epss map applied by CVE");

// riskSummary
const sum = riskSummary(pr);
eq(sum.total, 3, "summary total");
ok(sum.index > 0 && sum.index <= 100, "index in range");

// ── remediation-core ─────────────────────────────────────────────────────────
const sqlPlan = remediationPlan({ title: "SQL injection in ?id=", description: "" });
eq(sqlPlan.classId, "sqli", "sqli classified");
ok(sqlPlan.fixSteps.length >= 3, "sqli has fix steps");
ok(!!sqlPlan.snippet, "sqli has a code snippet");
ok(sqlPlan.references.some((r) => /CWE-89/.test(r.label)), "sqli references CWE-89");
ok(sqlPlan.verifySteps.length >= 1, "sqli has verify steps");

const generic = remediationPlan({ title: "Weird uncategorized thing", description: "", recommendation: "Do the vendor fix." });
eq(generic.classId, null, "unclassified → null class");
ok(generic.fixSteps[0].includes("vendor"), "unclassified merges stored recommendation");

// ── engine-core ──────────────────────────────────────────────────────────────
const en = enrich({ id: "x", title: "Reflected XSS in q param", description: "", severity: "medium" });
eq(en.classId, "reflected_xss", "enrich classifies xss");
ok(en.cwe === "CWE-79", "enrich surfaces CWE");

// attack chain: one asset with access + impact
const chainFindings: EngineFinding[] = [
  { id: "1", title: "SQL injection", description: "at https://target.com/api", severity: "critical", confirmed: true },
  { id: "2", title: "IDOR exposes user records", description: "at https://target.com/api", severity: "high" },
];
const intel = buildEngineIntel(chainFindings, new Set());
ok(intel.chains.length >= 1, "chain detected across access+impact");
eq(intel.chains[0].asset, "target.com", "chain asset resolved");
ok(intel.items[0].risk.score >= intel.items[1].risk.score, "engine items ranked");
ok(intel.planFor("1")?.classId === "sqli", "planFor returns a plan");
ok(intel.assets.length >= 1 && intel.surfaces.length >= 1, "rollups produced");

// KEV set wiring
const kevIntel = buildEngineIntel([{ id: "k", title: "Bug CVE-2020-0001", description: "https://x.com", severity: "high" }], new Set(["CVE-2020-0001"]));
ok(kevIntel.items[0].risk.knownExploited, "KEV set flags the finding");

console.log(`\nengine: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
