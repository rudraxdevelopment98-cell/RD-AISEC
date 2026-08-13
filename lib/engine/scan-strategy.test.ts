// Run: npx tsx lib/engine/scan-strategy.test.ts
import { scoreTargetHost, prioritizeHosts } from "./target-priority";
import { deriveHostSignals, scanToolSet, noSignal } from "./scan-plan";
import { scanDefaultSteps, planScanSteps } from "./strategy";

let pass = 0, fail = 0;
function ok(c: boolean, msg: string) { if (c) pass++; else { fail++; console.error(`✗ ${msg}`); } }
function eq(a: unknown, b: unknown, msg: string) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) pass++; else { fail++; console.error(`✗ ${msg}\n   exp ${y}\n   got ${x}`); }
}

// ── target-priority ──────────────────────────────────────────────────────────
ok(scoreTargetHost("admin.example.com") > scoreTargetHost("www.example.com"), "admin beats www");
ok(scoreTargetHost("api.example.com") > scoreTargetHost("example.com"), "api beats apex");
ok(scoreTargetHost("staging.example.com") > scoreTargetHost("blog.example.com"), "staging beats blog");
ok(scoreTargetHost("vpn.corp.example.com") > scoreTargetHost("cdn.example.com"), "vpn beats cdn");
// live signals sharpen the score
ok(scoreTargetHost("host.example.com", { openPorts: 8, hasWeb: true }) > scoreTargetHost("host.example.com"), "open ports raise score");

// prioritization orders promising first, stable within ties
// admin + api are both high-value (tie) → stable keeps their input order; both
// beat blog (med) which beats www (also med but later); high-value first overall.
eq(
  prioritizeHosts(["www.example.com", "api.example.com", "blog.example.com", "admin.example.com"]),
  ["api.example.com", "admin.example.com", "blog.example.com", "www.example.com"],
  "prioritized order (high-value first, stable within ties)",
);
// stable: two equally-boring hosts keep input order
eq(prioritizeHosts(["b.example.com", "a.example.com"]), ["b.example.com", "a.example.com"], "stable within ties");

// ── scan-plan ────────────────────────────────────────────────────────────────
// no signal → full default battery (never regress)
const empty = deriveHostSignals([]);
ok(noSignal(empty), "empty text → no signal");
eq([...scanToolSet(empty)].sort(), ["gobuster", "nikto", "nmap", "nuclei", "sslscan"], "no-signal → full set");

// web host → web tools, no wpscan/enum4linux
const web = deriveHostSignals(["httpx: https://x.com [200] nginx title: Home"]);
ok(!!(web.web && web.tls), "web+tls detected");
ok(scanToolSet(web).has("nuclei") && scanToolSet(web).has("gobuster") && scanToolSet(web).has("sslscan"), "web → nuclei/gobuster/sslscan");
ok(!scanToolSet(web).has("wpscan"), "plain web → no wpscan");

// WordPress → wpscan added
const wp = deriveHostSignals(["Detected WordPress 6.2 at https://blog.x.com/wp-login.php"]);
ok(!!wp.wordpress, "wordpress detected");
ok(scanToolSet(wp).has("wpscan"), "wordpress → wpscan");

// SMB host (ports, no web) → enum4linux, nmap; not the web tools
const smb = deriveHostSignals(["nmap: 445/tcp open microsoft-ds; 139/tcp open netbios-ssn"]);
ok(!!smb.smb, "smb detected");
ok(scanToolSet(smb).has("enum4linux") && scanToolSet(smb).has("nmap"), "smb → enum4linux+nmap");
ok(!scanToolSet(smb).has("gobuster"), "smb-only host → no gobuster");

// ── high-yield hunt + GraphQL probe wired into the staged pipeline ────────────
// The default (web) scan must include the high-yield exposure hunt (tags exposure/
// takeover/secret/…) AND the dedicated GraphQL probe, so a manual staged scan finds
// the same modern-class bugs the bug-bounty pipeline does.
const def = scanDefaultSteps(false);
const nucleiPasses = def.filter((s) => s.tool === "nuclei");
ok(nucleiPasses.length >= 2, "web default → default nuclei + high-yield nuclei pass");
ok(def.some((s) => /-tags [^ ]*exposure/.test(s.args) && /takeover/.test(s.args)), "web default → high-yield exposure hunt present");
ok(def.some((s) => /-tags graphql/.test(s.args)), "web default → GraphQL introspection probe present");

// Result-driven web host → same two passes appended.
const webPlan = planScanSteps(["httpx: https://x.com [200] nginx title: Home"], false);
ok(webPlan.some((s) => /-tags graphql/.test(s.args)), "web plan → GraphQL probe appended");
ok(webPlan.filter((s) => s.tool === "nuclei").length >= 2, "web plan → high-yield nuclei appended");

// SMB-only host (no web) → the URL-only passes must NOT be appended.
const smbPlan = planScanSteps(["nmap: 445/tcp open microsoft-ds; 139/tcp open netbios-ssn"], false);
ok(!smbPlan.some((s) => /-tags graphql/.test(s.args)), "smb-only host → no GraphQL probe");
ok(!smbPlan.some((s) => /-tags [^ ]*exposure/.test(s.args)), "smb-only host → no high-yield URL hunt");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
