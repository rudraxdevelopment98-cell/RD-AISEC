// Run: npx tsx lib/report-narrative.test.ts
import { buildStructuredReport } from "./report-narrative";
import { remediationFor } from "./vuln-taxonomy";

let pass = 0, fail = 0;
function ok(c: boolean, msg: string) { if (c) pass++; else { fail++; console.error(`✗ ${msg}`); } }

// remediationFor returns class-specific guidance, generic fallback otherwise.
ok(/parameterized|prepared statement/i.test(remediationFor("sqli")), "sqli remediation is specific");
ok(/introspection/i.test(remediationFor("graphql")), "graphql remediation is specific");
ok(/redirect_uri/i.test(remediationFor("oauth")), "oauth remediation is specific");
ok(/metadata|IMDSv2|169\.254/i.test(remediationFor("ssrf_metadata")), "ssrf_metadata remediation is specific");
ok(remediationFor("nonexistent").length > 20, "unknown id → generic fallback");
ok(remediationFor(null).length > 20, "null id → generic fallback");

// A structured report for a recognized class carries CWE + class-specific remediation.
{
  const md = buildStructuredReport({
    title: "GraphQL introspection enabled",
    severity: "high",
    description: "The /graphql endpoint returns the full __schema via introspection.",
    target: "https://api.example.com/graphql",
  });
  ok(/Vulnerability class/i.test(md) && /GraphQL Vulnerability/i.test(md), "draft names the GraphQL class");
  ok(/CWE-639/.test(md), "draft includes the CWE");
  ok(/## Steps to Reproduce/.test(md) && /## Remediation/.test(md), "draft has repro + remediation sections");
  ok(/introspection/i.test(md.split("## Remediation")[1] || ""), "remediation is class-specific, not generic");
}

// An unrecognized finding still produces a valid draft (no class metadata).
{
  const md = buildStructuredReport({ title: "Some odd finding", severity: "low", description: "n/a" });
  ok(/# Some odd finding/.test(md) && /## Remediation/.test(md), "unrecognized finding still yields a draft");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
