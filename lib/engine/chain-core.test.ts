// Run: npx tsx lib/engine/chain-core.test.ts
import { correlateChains, type ChainFinding } from "./chain-core";

let pass = 0, fail = 0;
function ok(c: boolean, msg: string) { if (c) pass++; else { fail++; console.error(`✗ ${msg}`); } }

const A = "https://app.example.com";
const B = "https://other.example.com";
let n = 0;
const f = (title: string, host = A, severity = "medium"): ChainFinding =>
  ({ id: `f${++n}`, title, description: `seen at ${host}`, severity });

// Named combo: SSRF + exposed secret on one asset → both boosted, specific label.
{
  const r = correlateChains([f("SSRF in url parameter"), f("Exposed AWS secret key AKIA...")]);
  ok(r.length === 2, "ssrf+secrets → both findings boosted");
  ok(r.every((x) => x.boost >= 28), "named-combo boost applied");
  ok(r.every((x) => /SSRF/.test(x.label)), "named-combo label");
}

// Named combo: file upload + RCE → biggest boost.
{
  const r = correlateChains([f("Unrestricted file upload allows webshell"), f("Remote code execution via deserialization")]);
  ok(r.length === 2 && r.every((x) => x.boost >= 30), "file_upload+rce → 30 boost");
  ok(r.every((x) => /code execution/i.test(x.label)), "file_upload+rce label");
}

// Generic access + impact (lfi=access, ssrf=impact) not a named combo → 18.
{
  const r = correlateChains([f("Local file inclusion ../../etc/passwd"), f("SSRF in url parameter")]);
  ok(r.length === 2 && r.every((x) => x.boost === 18), "generic access+impact → 18");
  ok(r.every((x) => /access \+ impact/i.test(x.label)), "generic chain label");
}

// A lone impact finding (no access partner, <3 stack) → NO chain.
ok(correlateChains([f("SSRF in url parameter")]).length === 0, "lone impact → no chain");

// Different hosts don't chain.
{
  const r = correlateChains([f("SSRF in url parameter", A), f("Exposed AWS secret key", B)]);
  ok(r.length === 0, "cross-host findings don't chain");
}

// ≥3 unrelated issues stack on one asset → modest boost to the worst.
{
  const r = correlateChains([
    f("Missing HSTS header", A, "low"),
    f("Directory listing enabled", A, "medium"),
    f("Verbose server banner", A, "low"),
  ]);
  ok(r.length === 1 && r[0].boost === 8, "3-stack → one 8-boost");
  ok(/stack/i.test(r[0].label), "stack label");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
