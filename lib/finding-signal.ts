// Triage signal score — pure, no DB/IO. Ranks a finding by how likely it is to
// be a REAL, actionable bug so the true issues surface above the noise. This
// does NOT change a finding's severity or confidence (those stay honest); it's
// a ranking/triage lens that combines what we already know:
//
//   signal ≈ severity  ×  proof confidence  +  cross-tool agreement
//            − unvalidated-CVE penalty  − common-low-severity-noise penalty
//
// Respects the project rule that corroboration must NOT inflate proof: extra
// tools nudge the RANK a little, never the confidence level.

import { CONFIDENCE_RANK, type Confidence } from "./exploit-confidence";
import { sourceCount } from "./dedup-core";

export type SignalInput = {
  severity: string;
  status: string;
  confidence?: Confidence | null;
  confirmed?: boolean | null;
  category?: string | null;
  sources?: string | null;
  title?: string | null;
};

export type SignalTier = "priority" | "review" | "low" | "noise";

const SEV_WEIGHT: Record<string, number> = { critical: 42, high: 30, medium: 18, low: 9, info: 3 };
const CONF_WEIGHT: Record<Confidence, number> = { reported: 0, validated: 22, proven: 40 };

// Real, but usually high-volume / low-priority classes — deprioritized, not dropped.
const NOISE_RE =
  /missing (security )?header|clickjack|x-frame|x-content-type|content-security-policy missing|\bhsts\b|referrer-policy|permissions-policy|cookie (without|missing|not) (secure|httponly|samesite)|server (banner|version|header) (disclos|leak|expos)|version (disclosure|banner)|directory listing|verbose error|autocomplete (on|enabled)|cacheable|robots\.txt|\.well-known|deprecated tls 1\.0/i;

export const TIER_LABEL: Record<SignalTier, string> = {
  priority: "Priority",
  review: "Review",
  low: "Low",
  noise: "Noise",
};

export const TIER_CLASS: Record<SignalTier, string> = {
  priority: "ring-red-500/40 text-red-300",
  review: "ring-amber-500/40 text-amber-300",
  low: "border-gray-500/40 text-gray-400",
  noise: "border-gray-600/40 text-gray-500",
};

/** Score a finding 0..100 with a triage tier and the reasons behind it. */
export function signalScore(f: SignalInput): { score: number; tier: SignalTier; reasons: string[] } {
  const reasons: string[] = [];
  if (f.status === "false_positive") return { score: 0, tier: "noise", reasons: ["marked false positive"] };

  let s = SEV_WEIGHT[f.severity] ?? 6;

  const conf: Confidence = f.confidence ?? (f.confirmed ? "validated" : "reported");
  s += CONF_WEIGHT[conf] ?? 0;
  if (conf === "proven") reasons.push("proven exploit");
  else if (conf === "validated") reasons.push("actively validated");

  // Cross-tool agreement: small rank nudge only (never inflates confidence).
  const n = sourceCount(f.sources);
  if (n > 1) {
    s += Math.min(18, (n - 1) * 6);
    reasons.push(`${n} tools agree`);
  }

  // A CVE matched by version/banner only (gated to "unverified") is the FP hot spot.
  if ((f.category ?? "").toLowerCase() === "unverified") {
    s -= 15;
    reasons.push("unvalidated CVE match");
  }

  if (NOISE_RE.test(f.title ?? "")) {
    s -= 12;
    reasons.push("common low-severity class");
  }

  // Resolved findings sink below anything still open.
  if (f.status === "fixed" || f.status === "accepted") s = Math.round(s * 0.4);

  s = Math.max(0, Math.min(100, Math.round(s)));
  const tier: SignalTier = s >= 58 ? "priority" : s >= 32 ? "review" : s >= 14 ? "low" : "noise";
  return { score: s, tier, reasons };
}

/** Convenience for sorting: higher signal first, severity as the tiebreak. */
export function bySignalDesc(a: SignalInput, b: SignalInput): number {
  const d = signalScore(b).score - signalScore(a).score;
  if (d !== 0) return d;
  return (CONFIDENCE_RANK[(b.confidence ?? "reported") as Confidence] ?? 0) - (CONFIDENCE_RANK[(a.confidence ?? "reported") as Confidence] ?? 0);
}
