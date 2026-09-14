/**
 * Exploit validators (P1) — the "proof gate".
 *
 * In 2026 the bounty market auto-rejects unproven / duplicate reports (HackerOne
 * Hai Triage), so a finding is worthless until we can PROVE it's real. This module
 * is the pure core: it maps a finding to the class we can validate, the job that
 * proves it, and the parser that reads a validation tool's output into a hard
 * verdict. Grounded in how the winners do it (per-class validators):
 *   - XSS  → dalfox headless verification: the payload actually EXECUTES in a real
 *            browser (dalfox marks verified hits `[V]` / `[POC]`).
 *   - SSRF / SSTI / XXE / blind-RCE / blind-SQLi → OAST: nuclei + interactsh; a
 *            real out-of-band callback (DNS/HTTP) proves the server processed it.
 *   - SQLi → sqlmap boolean/time differential confirmation.
 * See docs/ENGINE-EARNING-RESEARCH.md.
 */

/** Marker on Job.queuedBy so the result route knows a job PROVES a finding. */
export const VALIDATE_PREFIX = "validate:";

export type VulnClass = "xss" | "ssrf" | "ssti" | "sqli" | "xxe" | "rce" | "redirect" | "secret";

export type ValidationMethod = "headless-execution" | "oast-callback" | "differential" | "deterministic";

export type ValidationJob = {
  tool: string;
  /** Extra args appended to the tool preset for high-confidence proof mode. */
  args: string;
  method: ValidationMethod;
};

export type Proof = {
  proven: boolean;
  method: ValidationMethod | "none";
  /** A short evidence line for the report / audit (never secrets). */
  evidence: string;
};

// Keyword → class. Ordered so the most specific/most-payable win first.
const CLASS_RULES: { re: RegExp; cls: VulnClass }[] = [
  { re: /\bssti\b|template inj/i, cls: "ssti" },
  { re: /\bssrf\b|server.?side request/i, cls: "ssrf" },
  { re: /\bxxe\b|xml external/i, cls: "xxe" },
  { re: /\brce\b|remote code|command inj|os command/i, cls: "rce" },
  { re: /sql\s*inj|sqli\b/i, cls: "sqli" },
  { re: /open redirect/i, cls: "redirect" },
  { re: /\bxss\b|cross.?site scripting/i, cls: "xss" },
  { re: /exposed[^\n]*\b(secret|key|token|credential)|leaked[^\n]*\b(secret|key|token|credential)|api[ _-]?key|secret key|hard.?coded|credential leak/i, cls: "secret" },
];

/** The validatable class of a finding, or null if we have no automated proof for it. */
export function validatableClass(f: { title?: string; category?: string; description?: string }): VulnClass | null {
  const hay = `${f.title ?? ""} ${f.category ?? ""} ${f.description ?? ""}`;
  for (const r of CLASS_RULES) if (r.re.test(hay)) return r.cls;
  return null;
}

/**
 * The job that PROVES a class against `target`. The runner runs the tool in its
 * high-confidence mode (headless for XSS, OAST for blind classes, differential
 * for SQLi). Returns null when we can't auto-prove the class yet.
 */
export function validationJobFor(cls: VulnClass, _target: string): ValidationJob | null {
  switch (cls) {
    case "xss":
      // Force the headless browser so we only accept payloads that actually execute.
      return { tool: "dalfox", args: "--force-headless-verification --silence --no-spinner", method: "headless-execution" };
    case "ssrf":
      return { tool: "nuclei", args: "-dast -tags ssrf -interactsh-poll-duration 8", method: "oast-callback" };
    case "ssti":
      return { tool: "nuclei", args: "-dast -tags ssti -interactsh-poll-duration 8", method: "oast-callback" };
    case "xxe":
      return { tool: "nuclei", args: "-dast -tags xxe -interactsh-poll-duration 8", method: "oast-callback" };
    case "rce":
      return { tool: "nuclei", args: "-dast -tags rce,cmdi -interactsh-poll-duration 8", method: "oast-callback" };
    case "sqli":
      // sqlmap's own boolean/time confirmation is the differential proof.
      return { tool: "sqlmap", args: "--batch --level 2 --risk 2", method: "differential" };
    case "redirect":
      return { tool: "nuclei", args: "-dast -tags redirect", method: "deterministic" };
    case "secret":
      // Runner-native: re-fetch the source, re-extract the key locally, run ONE
      // read-only identity call per provider, report only live/who (never the key).
      return { tool: "secretvalidate", args: "", method: "deterministic" };
    default:
      return null;
  }
}

/** True when a line looks like a real nuclei OOB/interactsh interaction (not just a probe). */
function nucleiOob(output: string): boolean {
  const oob = /interactsh|out-of-band|\boast\b|interaction|"?oob"?/i.test(output);
  // A confirmed nuclei hit prints the template id in brackets + the matched URL.
  const hit = /\[[a-z0-9._-]+\]\s+\[(http|dns|tcp)\]/i.test(output) || /\bhigh\b|\bcritical\b/i.test(output);
  return oob && hit;
}

/**
 * Parse a validation tool's raw output into a hard proof verdict. Conservative by
 * design: when in doubt, NOT proven (an unproven finding must never be surfaced
 * as reportable). Pure + tested.
 */
export function parseValidationProof(tool: string, output: string): Proof {
  const out = output || "";
  const t = tool.toLowerCase();

  if (t === "dalfox") {
    // `[V]` = headless-verified (payload executed); `[POC]` with a trigger note.
    const v = out.match(/\[V\][^\n]*/);
    if (v) return { proven: true, method: "headless-execution", evidence: firstLine(v[0]) };
    const poc = out.match(/\[POC\][^\n]*/i);
    if (poc && /triggered|verif|executed/i.test(out)) {
      return { proven: true, method: "headless-execution", evidence: firstLine(poc[0]) };
    }
    return { proven: false, method: "none", evidence: "dalfox did not verify execution (reflection only)" };
  }

  if (t === "nuclei") {
    if (nucleiOob(out)) {
      const line = (out.match(/[^\n]*interact[^\n]*/i) || out.match(/\[[a-z0-9._-]+\]\s+\[[^\]]+\][^\n]*/i) || [""])[0];
      return { proven: true, method: "oast-callback", evidence: firstLine(line) || "out-of-band interaction observed" };
    }
    // Open redirect is proven DETERMINISTICALLY (no OOB callback): a redirect DAST
    // template that fired IS the proof. Match a nuclei hit whose template id names
    // redirect, e.g. "[open-redirect] [http] [medium] https://…".
    const redir = out.match(/\[[a-z0-9._-]*redirect[a-z0-9._-]*\]\s+\[https?\][^\n]*/i);
    if (redir) return { proven: true, method: "deterministic", evidence: firstLine(redir[0]) };
    return { proven: false, method: "none", evidence: "no out-of-band interaction observed" };
  }

  if (t === "secretvalidate") {
    // Runner prints one line per key: "<provider> live=true who=<identity> key=…abcd".
    const live = out.match(/^[^\n]*\blive=true\b[^\n]*$/im);
    if (live) return { proven: true, method: "deterministic", evidence: firstLine(live[0]) };
    return { proven: false, method: "none", evidence: "no live credential (placeholder/revoked)" };
  }

  if (t === "sqlmap") {
    if (/is vulnerable|parameter '[^']+' (?:is|appears to be) .*vulnerable|the back-end DBMS is|sqlmap identified the following injection/i.test(out)) {
      const line = (out.match(/[^\n]*Parameter[^\n]*vulnerable[^\n]*/i) || out.match(/[^\n]*back-end DBMS[^\n]*/i) || [""])[0];
      return { proven: true, method: "differential", evidence: firstLine(line) || "sqlmap confirmed injection (boolean/time)" };
    }
    return { proven: false, method: "none", evidence: "sqlmap did not confirm injection" };
  }

  return { proven: false, method: "none", evidence: "no validator for this tool" };
}

function firstLine(s: string): string {
  return (s || "").split("\n")[0].trim().slice(0, 240);
}
