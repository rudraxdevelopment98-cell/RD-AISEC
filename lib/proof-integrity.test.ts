// Proof-integrity tests (Workstream A) — the engine must NOT mark a finding
// "confirmed" without real proof, and must NOT lose genuine proof. Run: npm test.

import assert from "node:assert";
import { classifyConfidence } from "./exploit-confidence";
import { gateFindings } from "./finding-gate";
import { parseValidationProof } from "./engine/validators";

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok -", name);
}

// ── classifyConfidence: over-eager signals must NOT validate ──────────────────
t("bare 'VULNERABLE' word is NOT validated; structured 'State: VULNERABLE' is", () => {
  assert.strictEqual(classifyConfidence({ description: "template name: vulnerable-thing VULNERABLE" }).level, "reported");
  assert.strictEqual(classifyConfidence({ description: "State: VULNERABLE (CVE-2017-0144)" }).level, "validated");
  assert.strictEqual(classifyConfidence({ description: "[+] 10.0.0.1:445 is vulnerable" }).level, "validated");
});

t("dalfox [POC]/reflected is NOT validated; verified/[V] is", () => {
  assert.strictEqual(classifyConfidence({ description: "dalfox reflected a payload (PoC only)" }).level, "reported");
  assert.strictEqual(classifyConfidence({ description: "dalfox verified XSS execution [V]" }).level, "validated");
});

t("genuine direct observations (IDOR, SMB, SNMP) stay validated", () => {
  assert.strictEqual(classifyConfidence({ description: "differential access test proved broken object-level authorization" }).level, "validated");
  assert.strictEqual(classifyConfidence({ description: "SMB message signing is not required" }).level, "validated");
});

t("conclusive nuclei classes (takeover, exposure) stay confirmed through the gate", () => {
  const takeover = gateFindings([
    { title: "Subdomain takeover — sub.acme.com", severity: "high", description: "Tags: takeover\n\nSubdomain takeover confirmed: the template fingerprinted the dangling service.", confirmed: true },
  ]);
  assert.strictEqual(takeover.kept[0].confirmed, true, "takeover stays confirmed");
  const exposure = gateFindings([
    { title: "Exposed .git — acme.com", severity: "high", description: "Tags: exposure config\n\nExposed resource confirmed: the template retrieved the sensitive file/secret.", confirmed: true },
  ]);
  assert.strictEqual(exposure.kept[0].confirmed, true, "exposed .git stays confirmed");
});

// ── gateFindings: re-derive confirmed from evidence, both directions ──────────
t("gate DE-CONFIRMS a finding whose text has no real proof", () => {
  const { kept } = gateFindings([
    { title: "XSS on x.com", severity: "high", description: "reflected payload, PoC only", confirmed: true },
  ]);
  assert.strictEqual(kept[0].confirmed, false, "unproven finding must be de-confirmed");
});

t("gate KEEPS confirmed when the text carries genuine proof", () => {
  const { kept } = gateFindings([
    { title: "SQLi on x.com", severity: "critical", description: "sqlmap identified a SQL injection point", confirmed: true },
  ]);
  assert.strictEqual(kept[0].confirmed, true, "proven finding stays confirmed");
});

// ── parseValidationProof: OAST/dalfox must require real proof ─────────────────
t("nuclei: words 'interactsh'+'high' alone are NOT proof; a real match line is", () => {
  assert.strictEqual(parseValidationProof("nuclei", "using -interactsh-poll-duration; severity high legend").proven, false);
  assert.strictEqual(parseValidationProof("nuclei", "[ssrf-oob] [http] [high] https://target/?url=x").proven, true);
});

t("dalfox: [POC] is not proof; [V] is", () => {
  assert.strictEqual(parseValidationProof("dalfox", "[POC] https://x.com/?q=<script>").proven, false);
  assert.strictEqual(parseValidationProof("dalfox", "[V] https://x.com/?q= triggered").proven, true);
});

console.log(`\n${passed} passed`);
