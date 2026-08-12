// Run: npx tsx lib/dedup-core.test.ts
import { findingSignature, dedupFindings } from "./dedup-core";

let pass = 0, fail = 0;
function ok(c: boolean, msg: string) { if (c) pass++; else { fail++; console.error(`✗ ${msg}`); } }

const host = "target.com";
const ports = [
  { title: "Open port 22/tcp (ssh) on target.com" },
  { title: "Open port 80/tcp (http) on target.com" },
  { title: "Open port 443/tcp (https) on target.com" },
];

// Regression: distinct open ports on one host must have DISTINCT signatures
// (they used to collapse to one because the normalizer strips the port number).
{
  const sigs = new Set(ports.map((p) => findingSignature(p, host)));
  ok(sigs.size === 3, `three ports → three signatures (got ${sigs.size})`);
}

// And through the real dedup path: all three survive as fresh findings.
{
  const { fresh, merges } = dedupFindings(ports, [], "nmap", host);
  ok(fresh.length === 3, `dedup keeps all 3 open ports (got ${fresh.length})`);
  ok(merges.length === 0, "no spurious merges across distinct ports");
}

// The SAME port reported twice (nmap + masscan style) still merges to one.
{
  const dup = [
    { title: "Open port 22/tcp (ssh) on target.com" },
    { title: "Open port 22/tcp (ssh) on target.com" },
  ];
  const { fresh } = dedupFindings(dup, [], "nmap", host);
  ok(fresh.length === 1, `identical port dedups to 1 (got ${fresh.length})`);
}

// Classified near-duplicates (varying "(N)" count) still collapse to one.
{
  const a = { title: "Weak TLS ciphers on target.com (3)", description: "weak tls cipher suites" };
  const b = { title: "Weak TLS ciphers on target.com (7)", description: "weak tls cipher suites" };
  ok(
    findingSignature(a, host) === findingSignature(b, host),
    "weak-TLS (3) and (7) share a signature (classified path)",
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
