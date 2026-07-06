// Import-time accuracy gate — the main false-positive reducer.
//
// Parsers turn raw tool output into candidate findings, but a scanner *detecting*
// something (a version banner, a template match) is a hypothesis, not a proven
// vulnerability. This gate runs every candidate through the freshness + proof
// engines BEFORE it becomes a stored finding, so the engine surfaces real issues
// instead of noise:
//
//   • patched  → DROP entirely (detected version is outside the CVE's affected
//                range — a definitive false positive).
//   • verify   → keep, but de-confirm, tag "unverified", cap severity at medium,
//                and note why (a CVE matched by banner/version only, never
//                demonstrated on the live target — the classic nuclei FP).
//   • current  → keep as-is. This includes findings that were actively validated
//                (sqlmap/dalfox/msf) and non-CVE findings (leaked secrets, weak
//                TLS) — those keep their parser-assigned severity/confirmed.
//
// Pure (no DB/IO) so it's unit-testable and reusable by every import path.

import { assessFreshness } from "./vuln-freshness";
import { classifyConfidence } from "./exploit-confidence";
import { reconcileSeverity } from "./severity-reconcile";

export type GateFinding = {
  title: string;
  severity: string;
  status?: string;
  description?: string;
  recommendation?: string;
  attack?: string;
  owasp?: string;
  confirmed?: boolean;
  category?: string;
};

export type GateResult<T> = { kept: T[]; dropped: number; softened: number; reconciled: number };

const SOFTEN: Record<string, string> = { critical: "medium", high: "medium" };

/** Reconcile a kept finding's severity against its vuln class + evidence. */
function withReconciledSeverity<T extends GateFinding>(f: T, confirmed: boolean): { finding: T; changed: boolean } {
  const conf = confirmed ? ("validated" as const) : ("reported" as const);
  const rec = reconcileSeverity({
    severity: f.severity,
    title: f.title,
    description: f.description,
    confidence: conf,
    category: f.category,
  });
  if (!rec.changed) return { finding: f, changed: false };
  return {
    finding: { ...f, severity: rec.severity, description: `${(f.description ?? "").trim()}\n\n⚖ ${rec.reason}`.trim() },
    changed: true,
  };
}

/** Run candidate findings through the freshness + confidence engines. */
export function gateFindings<T extends GateFinding>(findings: T[]): GateResult<T> {
  const kept: T[] = [];
  let dropped = 0;
  let softened = 0;
  let reconciled = 0;

  for (const f of findings) {
    // Judge on the finding's OWN EVIDENCE, not the parser's `confirmed` flag —
    // that flag is exactly what's over-eager (a version/banner CVE match sets it
    // too), so trusting it would defeat the gate. We re-derive validation from
    // the text and re-attach a trustworthy `confirmed` below.
    const ev = { title: f.title, description: f.description, confirmedFlag: false as const };
    const fresh = assessFreshness(ev);

    // Findings WITHOUT a CVE aren't the banner-false-positive case (leaked
    // secrets, confirmed XSS/SQLi, weak TLS, missing headers…). Trust the parser
    // as-is — these are where the real, high-signal findings live.
    if (!fresh.cve) {
      const conf = classifyConfidence({ title: f.title, description: f.description, confirmedFlag: f.confirmed });
      const r = withReconciledSeverity(f, conf.level !== "reported");
      if (r.changed) reconciled += 1;
      kept.push(r.finding);
      continue;
    }

    // CVE-bearing findings get the strict treatment — this is the FP hot spot.
    if (fresh.verdict === "patched") {
      // Detected version is outside the CVE's affected range → definitive FP.
      dropped += 1;
      continue;
    }

    if (fresh.verdict === "verify") {
      // Matched by version/banner only, never demonstrated live. Keep it (worth a
      // manual check) but strip the false confidence + inflated severity.
      const severity = SOFTEN[f.severity] ?? f.severity;
      if (severity !== f.severity) softened += 1;
      kept.push({
        ...f,
        severity,
        confirmed: false,
        category: f.category || "unverified",
        description: `${(f.description ?? "").trim()}\n\n⚠ Unvalidated: ${fresh.reason}`.trim(),
      });
      continue;
    }

    // "current" for a CVE finding means the text shows it was actually validated
    // on the target. Keep confirmed only when the proof engine agrees.
    const conf = classifyConfidence(ev);
    const confirmed = conf.level !== "reported";
    const r = withReconciledSeverity({ ...f, confirmed }, confirmed);
    if (r.changed) reconciled += 1;
    kept.push(r.finding);
  }

  return { kept, dropped, softened, reconciled };
}
