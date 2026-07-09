// Engine risk scoring — the prioritization brain.
//
// Turns a finding into a single, explainable 0–100 risk score and a P1–P4
// priority tier, by combining: technical severity (CVSS), whether we PROVED it
// exploitable, real-world exploit signals (CISA KEV = actively exploited, EPSS =
// predicted exploitation probability), and exposure (internet-facing /
// unauthenticated). Every point is attributable to a factor, so the UI can show
// *why* something ranks where it does — not a black box.
//
// Pure (no DB/IO), so it is client-safe and unit-tested. It reuses the vuln
// taxonomy for a CVSS band when the finding text carries no explicit vector.

import { classifyFindingVuln } from "@/lib/vuln-taxonomy";

export type Sev = "critical" | "high" | "medium" | "low" | "info";

export type RiskInput = {
  title: string;
  description?: string | null;
  severity: string;
  confirmed?: boolean;
  reviewed?: boolean;
  status?: string | null; // open | fixed | accepted | false_positive
  category?: string | null;
  /** 0..1 EPSS probability, if known (optional — scoring degrades gracefully). */
  epss?: number | null;
  /** override: force known-exploited (CISA KEV) rather than deriving from text. */
  knownExploited?: boolean;
};

export type Tier = "P1" | "P2" | "P3" | "P4";

export type RiskFactor = { label: string; delta: number; detail: string };

export type RiskScore = {
  score: number; // 0..100
  tier: Tier;
  tierLabel: string;
  cvss: number; // 0..10 (derived)
  epss: number | null; // 0..1 if known
  knownExploited: boolean;
  exposure: Exposure;
  factors: RiskFactor[]; // explainable breakdown, largest first
  sla: string; // remediation timeframe
};

export type Exposure = "internet" | "unauthenticated" | "internal" | "unknown";

const SEV_MID: Record<Sev, number> = { critical: 9.5, high: 8.0, medium: 5.5, low: 2.5, info: 0 };
const CVE_RE = /\bCVE-\d{4}-\d{3,7}\b/i;

/**
 * Pull an explicit CVSS base score (0–10) from text, tolerating a preceding
 * version/vector ("CVSS:3.1/AV:N/… 9.8"). Strategy: scan a window after the word
 * "cvss" and take the last plausible score — a decimal 0–10 or exactly "10" —
 * which skips the "3.1" version prefix and ignores unrelated integers (ports).
 */
function explicitCvss(text: string): number | null {
  const idx = text.toLowerCase().indexOf("cvss");
  if (idx < 0) return null;
  const window = text.slice(idx + 4, idx + 84);
  const nums = window.match(/\d{1,2}(?:\.\d)?/g) ?? [];
  const scores = nums.filter((s) => s.includes(".") || s === "10").map(Number).filter((n) => n >= 0 && n <= 10);
  if (!scores.length) return null;
  return round1(scores[scores.length - 1]);
}

export function normSev(s: string): Sev {
  const v = (s || "").toLowerCase();
  return (["critical", "high", "medium", "low", "info"] as Sev[]).includes(v as Sev) ? (v as Sev) : "medium";
}

export function firstCve(text: string): string | null {
  return text.match(CVE_RE)?.[0]?.toUpperCase() ?? null;
}

/**
 * Derive a numeric CVSS (0–10) for a finding: an explicit score/vector in the
 * text wins; else the vuln class's representative band midpoint; else the
 * severity midpoint.
 */
export function cvssFor(input: RiskInput): number {
  const text = `${input.title}\n${input.description ?? ""}`;
  const explicit = explicitCvss(text);
  if (explicit != null) return explicit;
  const cls = classifyFindingVuln({ title: input.title, description: input.description });
  if (cls) {
    const band = parseBandMid(cls.cvss);
    if (band != null) return band;
  }
  return SEV_MID[normSev(input.severity)];
}

/** Detect where a finding lives from its text/category. */
export function exposureOf(input: RiskInput): Exposure {
  const t = `${input.title} ${input.description ?? ""} ${input.category ?? ""}`.toLowerCase();
  if (/\bhttps?:\/\//.test(t) || /internet|public|external|exposed|world-readable|anonymous/.test(t)) {
    if (/unauth|no auth|without (a )?login|pre-auth|anonymous|default cred/.test(t)) return "unauthenticated";
    return "internet";
  }
  if (/internal|intranet|lan|localhost|127\.0\.0\.1|rfc1918|10\.|192\.168\./.test(t)) return "internal";
  return "unknown";
}

/**
 * Score a finding 0–100 with an explainable factor breakdown. Weighting (senior
 * pentest judgement, tuned so a proven, actively-exploited, internet-facing
 * critical pins near 100 and an unproven info item floors near 0):
 *   • CVSS technical severity           → up to 60
 *   • Proven exploitable (we ran a PoC) → +18
 *   • CISA KEV (exploited in the wild)  → +22
 *   • EPSS (predicted exploitation)     → up to +14
 *   • Exposure (internet / unauth)      → up to +12
 *   • Lifecycle (fixed / accepted / FP) → strong negatives
 */
export function scoreFinding(input: RiskInput): RiskScore {
  const factors: RiskFactor[] = [];
  const cvss = cvssFor(input);
  const sev = normSev(input.severity);
  const kev = input.knownExploited ?? isKevText(`${input.title} ${input.description ?? ""}`);
  const exposure = exposureOf(input);
  const epss = typeof input.epss === "number" && input.epss >= 0 && input.epss <= 1 ? input.epss : null;

  // Base: technical severity (0–60).
  const base = round(clamp((cvss / 10) * 60, 0, 60));
  factors.push({ label: "Technical severity", delta: base, detail: `CVSS ${cvss.toFixed(1)} (${sev})` });

  // Proven exploitable.
  if (input.confirmed) factors.push({ label: "Proven exploitable", delta: 18, detail: "validated with a working PoC" });

  // Actively exploited in the wild.
  if (kev) factors.push({ label: "Actively exploited (KEV)", delta: 22, detail: "in CISA Known Exploited catalog" });

  // Predicted exploitation probability.
  if (epss != null && epss >= 0.01) {
    const d = round(clamp(epss * 14, 0, 14));
    if (d > 0) factors.push({ label: "Exploit likelihood (EPSS)", delta: d, detail: `${(epss * 100).toFixed(1)}% predicted` });
  }

  // Exposure.
  if (exposure === "unauthenticated") factors.push({ label: "Exposure", delta: 12, detail: "internet-facing & unauthenticated" });
  else if (exposure === "internet") factors.push({ label: "Exposure", delta: 8, detail: "internet-facing" });
  else if (exposure === "internal") factors.push({ label: "Exposure", delta: -4, detail: "internal-only" });

  // Lifecycle negatives.
  const st = (input.status ?? "open").toLowerCase();
  if (st === "false_positive") factors.push({ label: "False positive", delta: -100, detail: "marked not a real issue" });
  else if (st === "fixed") factors.push({ label: "Remediated", delta: -60, detail: "already fixed" });
  else if (st === "accepted") factors.push({ label: "Risk accepted", delta: -30, detail: "accepted by owner" });

  const score = round(clamp(factors.reduce((a, f) => a + f.delta, 0), 0, 100));
  const tier = tierFor(score, { kev, confirmed: !!input.confirmed, sev });
  factors.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    score,
    tier,
    tierLabel: TIER_LABEL[tier],
    cvss,
    epss,
    knownExploited: kev,
    exposure,
    factors,
    sla: SLA[tier],
  };
}

/** Tier from score, with overrides so a proven/KEV critical never sinks below P1. */
export function tierFor(score: number, ctx: { kev: boolean; confirmed: boolean; sev: Sev }): Tier {
  if (score >= 100) return "P1";
  if ((ctx.kev || ctx.confirmed) && ctx.sev === "critical" && score >= 60) return "P1";
  if (score >= 80) return "P1";
  if (score >= 60) return "P2";
  if (score >= 35) return "P3";
  return "P4";
}

export const TIER_LABEL: Record<Tier, string> = {
  P1: "Critical — fix now",
  P2: "High — fix this sprint",
  P3: "Medium — planned",
  P4: "Low — backlog",
};

const SLA: Record<Tier, string> = {
  P1: "24–72 hours",
  P2: "≤ 1 week",
  P3: "≤ 30 days",
  P4: "Backlog / next cycle",
};

export type Scored<T> = T & { risk: RiskScore };

/** Score + rank a list of findings, highest risk first. */
export function prioritize<T extends RiskInput>(findings: T[], epssMap?: Map<string, number>): Scored<T>[] {
  return findings
    .map((f) => {
      const cve = firstCve(`${f.title} ${f.description ?? ""}`);
      const epss = f.epss ?? (cve && epssMap ? epssMap.get(cve) ?? null : null);
      return { ...f, risk: scoreFinding({ ...f, epss }) };
    })
    .sort((a, b) => b.risk.score - a.risk.score);
}

/** Roll a scored list into tier counts + a portfolio risk index (0–100). */
export function riskSummary<T>(scored: Scored<T>[]): {
  tiers: Record<Tier, number>;
  index: number;
  kev: number;
  confirmed: number;
  total: number;
} {
  const tiers: Record<Tier, number> = { P1: 0, P2: 0, P3: 0, P4: 0 };
  let kev = 0, confirmed = 0, top = 0;
  for (const s of scored) {
    tiers[s.risk.tier] += 1;
    if (s.risk.knownExploited) kev += 1;
    if ((s as { confirmed?: boolean }).confirmed) confirmed += 1;
    top = Math.max(top, s.risk.score);
  }
  // Portfolio index: weight the worst offenders (a few P1s should dominate).
  const weighted = scored.slice(0, 20).reduce((a, s, i) => a + s.risk.score * (1 - i * 0.03), 0);
  const denom = scored.slice(0, 20).reduce((a, _s, i) => a + (1 - i * 0.03), 0) || 1;
  const index = scored.length ? round(clamp(weighted / denom, 0, 100)) : 0;
  return { tiers, index, kev, confirmed, total: scored.length };
}

// ── helpers ─────────────────────────────────────────────────────────────────
function isKevText(text: string): boolean {
  return /\bkev\b|known exploited|actively exploited|exploited in the wild/i.test(text);
}
function parseBandMid(band: string): number | null {
  const nums = band.match(/\d{1,2}(?:\.\d)?/g);
  if (!nums || !nums.length) return null;
  const vals = nums.map(Number).filter((n) => Number.isFinite(n));
  if (!vals.length) return null;
  return round1((Math.min(...vals) + Math.max(...vals)) / 2);
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round(n: number): number {
  return Math.round(n);
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
