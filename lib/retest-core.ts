// Pure helpers for the remediation retest loop (pentest deliverable).
// No DB/IO — usable server or client and unit-testable.

export const RETEST_STATES = ["", "requested", "passed", "failed"] as const;
export type RetestState = (typeof RETEST_STATES)[number];

export const RETEST_LABEL: Record<string, string> = {
  "": "Not requested",
  requested: "Retest requested",
  passed: "Verified fixed",
  failed: "Still exploitable",
};

// tag classes per retest state (dark theme).
export const RETEST_CLASS: Record<string, string> = {
  "": "border-gray-600/40 text-gray-500",
  requested: "border-amber-500/40 text-amber-300",
  passed: "ring-emerald accent-emerald",
  failed: "border-red-500/40 text-red-300",
};

export type RemediationLike = { status: string; retest: string; severity: string };

/** Roll up findings into a remediation posture for the report + progress view. */
export function remediationStats(findings: RemediationLike[]): {
  total: number;
  open: number;
  requested: number;
  verifiedFixed: number;
  stillExploitable: number;
  /** % of findings verified-fixed on retest, 0-100 (0 when nothing to fix). */
  closedPct: number;
} {
  let open = 0;
  let requested = 0;
  let verifiedFixed = 0;
  let stillExploitable = 0;
  for (const f of findings) {
    if (f.retest === "passed") verifiedFixed += 1;
    else if (f.retest === "failed") stillExploitable += 1;
    else if (f.retest === "requested") requested += 1;
    if (f.status === "open") open += 1;
  }
  const total = findings.length;
  const closedPct = total > 0 ? Math.round((verifiedFixed / total) * 100) : 0;
  return { total, open, requested, verifiedFixed, stillExploitable, closedPct };
}
