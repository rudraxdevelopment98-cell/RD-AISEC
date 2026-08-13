// Run: npx tsx lib/vuln-taxonomy.test.ts
import { classifyVuln } from "./vuln-taxonomy";

let pass = 0, fail = 0;
function ok(c: boolean, msg: string) { if (c) pass++; else { fail++; console.error(`✗ ${msg}`); } }
const id = (t: string) => classifyVuln(t)?.id ?? null;

// Modern high-value classes (2024–2025) are recognized.
ok(id("Prompt injection: model ignored its system prompt") === "prompt_injection", "prompt injection");
ok(id("Indirect prompt injection via retrieved document") === "prompt_injection", "indirect prompt injection");
ok(id("GraphQL introspection enabled — full __schema exposed") === "graphql", "graphql introspection");
ok(id("OAuth redirect_uri manipulation allows code theft") === "oauth", "oauth redirect_uri");
ok(id("HTTP request smuggling via CL.TE desync") === "request_smuggling", "request smuggling");
ok(id("Web cache poisoning through unkeyed X-Forwarded-Host header") === "cache_poisoning", "cache poisoning");
ok(id("Prototype pollution via __proto__ in JSON body") === "prototype_pollution", "prototype pollution");
ok(id("Race condition: coupon redeemed twice via concurrent requests") === "race_condition", "race condition");
ok(id("Business logic flaw: negative quantity yields a refund") === "business_logic", "business logic");

// Tier sanity — these are high-value, not noise.
ok(classifyVuln("GraphQL introspection enabled")?.tier === "high", "graphql tier high");
ok(classifyVuln("Prompt injection jailbreak")?.tier === "high", "prompt injection tier high");

// SSRF → cloud metadata is elevated to its own CRITICAL class (top-payout chain).
ok(id("SSRF fetches http://169.254.169.254/latest/meta-data/iam/security-credentials returning IAM role credentials") === "ssrf_metadata", "ssrf→metadata classified");
ok(classifyVuln("SSRF to 169.254.169.254 leaked IAM token")?.tier === "critical", "ssrf→metadata is critical");
// Plain SSRF (no metadata) stays high, not critical.
ok(id("SSRF: server fetches an attacker-supplied URL") === "ssrf", "plain ssrf stays generic");
ok(classifyVuln("SSRF: server fetches an attacker-supplied URL")?.tier === "high", "plain ssrf stays high");

// Classics still classify (no regression).
ok(id("SQL injection in id parameter") === "sqli", "sqli still works");
ok(id("Server-side request forgery reaching an internal admin service") === "ssrf", "ssrf still works");
ok(id("Reflected XSS in search parameter") === "reflected_xss", "reflected xss still works");
ok(classifyVuln("Missing X-Frame-Options header")?.tier === "low", "headers stay low");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
