// Human-review gate — pure, no DB/IO. Master policy: high-impact findings must
// be approved by a human before they're "published" (compiled into a deliverable
// report or submitted to a program). This decides WHICH findings require review
// and why; the `reviewed` flag on the finding records the approval. Nothing here
// publishes anything on its own.

import { assessFinding } from "./bb-engine";

// Vuln classes (from the bug-bounty engine) that mandate human sign-off.
const REVIEW_CLASSES = new Set<string>([
  "account takeover",
  "RCE",
  "auth bypass",
  "IDOR / broken access",
  "SSRF",
  "privilege escalation",
  "SQL injection", // → database compromise / sensitive data
  "secret exposure",
]);

// Extra text signals the class matcher may miss (payment / sensitive PII).
const REVIEW_TEXT = /\bpayment|checkout|billing|credit card|\bpii\b|sensitive (data|information)|personal data|account takeover/i;

export type ReviewVerdict = { required: boolean; reasons: string[] };

/**
 * Does this finding require human review before publication/submission?
 * Required when it's a high-impact class, a critical-severity issue, or a
 * confirmed-exploitable finding. Informational/recon artifacts never require it.
 */
export function requiresHumanReview(finding: {
  title: string;
  description?: string | null;
  severity?: string | null;
  evidence?: string | null;
  confirmedFlag?: boolean | null;
}): ReviewVerdict {
  const q = assessFinding({
    title: finding.title,
    description: finding.description,
    severity: finding.severity,
    evidence: finding.evidence,
    confirmedFlag: finding.confirmedFlag,
  });
  if (q.state === "informational") return { required: false, reasons: [] };

  const reasons: string[] = [];
  if (q.vulnClass && REVIEW_CLASSES.has(q.vulnClass)) reasons.push(`high-impact class (${q.vulnClass})`);
  if (REVIEW_TEXT.test(`${finding.title}\n${finding.description ?? ""}`)) reasons.push("payment / sensitive-data context");
  if (q.severity === "critical") reasons.push("critical severity");
  if (q.state === "confirmed_exploitable") reasons.push("confirmed exploitable");

  return { required: reasons.length > 0, reasons };
}

/** Publication status for a finding given its stored `reviewed` flag. */
export type PublishState = "ok" | "pending_review" | "reviewed";

export function publishState(
  finding: Parameters<typeof requiresHumanReview>[0] & { reviewed?: boolean | null },
): PublishState {
  const { required } = requiresHumanReview(finding);
  if (!required) return "ok";
  return finding.reviewed ? "reviewed" : "pending_review";
}
