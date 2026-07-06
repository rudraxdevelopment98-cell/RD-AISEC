// Cross-tool severity reconciliation — pure, no DB/IO. Different tools label the
// same weakness with different severities (nuclei "info" for a real SQLi, nikto
// "high" for a banner). This reconciles a finding's severity toward the curated
// vuln-CLASS baseline (lib/vuln-taxonomy) + the finding's EVIDENCE, so severity
// reflects the bug, not which scanner happened to report it.
//
// Deliberately conservative and honest:
//   • RAISE an under-rated finding to its class baseline (don't miss a critical
//     that a tool labelled medium).
//   • LOWER an over-rated finding only when it's UNVALIDATED (reported) — a
//     validated/proven finding keeps its higher severity, because the evidence
//     earns it.
//   • Unvalidated high-impact classes are capped at "high" (never "critical"
//     without proof), matching the confidence philosophy.
//   • CVE banner-only matches (category "unverified") are left to the freshness
//     gate — not touched here.

import { classifyVuln } from "./vuln-taxonomy";
import type { Confidence } from "./exploit-confidence";

const SEV_NUM: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const NUM_SEV = ["info", "low", "medium", "high", "critical"] as const;

export type ReconcileInput = {
  severity: string;
  title?: string | null;
  description?: string | null;
  evidence?: string | null;
  confidence?: Confidence | null;
  category?: string | null;
};

export type ReconcileResult = { severity: string; changed: boolean; reason?: string };

export function reconcileSeverity(f: ReconcileInput): ReconcileResult {
  const parser = SEV_NUM[f.severity] ?? -1;
  if (parser < 0) return { severity: f.severity, changed: false };

  // Banner-only CVE matches are the freshness gate's job — don't re-rate here.
  if ((f.category ?? "").toLowerCase() === "unverified") return { severity: f.severity, changed: false };

  const cls = classifyVuln(`${f.title ?? ""}\n${f.description ?? ""}\n${f.evidence ?? ""}`);
  if (!cls) return { severity: f.severity, changed: false }; // nothing to reconcile against

  const validated = f.confidence === "validated" || f.confidence === "proven";
  let target = SEV_NUM[cls.tier] ?? parser;

  // Unvalidated high-impact classes can't claim "critical" without proof.
  if (!validated && target === 4) target = 3;

  if (target > parser) {
    return { severity: NUM_SEV[target], changed: true, reason: `severity reconciled up to ${NUM_SEV[target]} — matches ${cls.label}` };
  }
  if (target < parser && !validated) {
    return { severity: NUM_SEV[target], changed: true, reason: `severity reconciled down to ${NUM_SEV[target]} — unvalidated ${cls.label}` };
  }
  return { severity: f.severity, changed: false };
}
