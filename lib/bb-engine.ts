// Bug-bounty accuracy engine — pure, deterministic, no DB/IO. Encodes the
// RD-AISEC master policy so the platform reports like a senior triager:
//   • accuracy over quantity, validation over assumptions, evidence over guesses
//   • a scanner DETECTING something is a hypothesis, never a confirmed vuln
//   • recon artifacts / missing headers / banners are INFORMATIONAL, not findings
//   • severity is capped by confidence; CRITICAL needs demonstrated impact
//   • every finding carries a state, a 0–100 confidence, and a bug-bounty
//     probability so low-value noise can be filtered out of reports and triage.
// Live threat-intel (NVD/EPSS/KEV) and adaptive learning are layered on top
// elsewhere; this module is the offline, always-correct policy core.

import { classifyConfidence } from "./exploit-confidence";
import { assessFreshness } from "./vuln-freshness";

export type Sev = "info" | "low" | "medium" | "high" | "critical";
const SEV_RANK: Record<Sev, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const SEV_BY_RANK: Sev[] = ["info", "low", "medium", "high", "critical"];
function capSeverity(s: Sev, max: Sev): Sev {
  return SEV_RANK[s] > SEV_RANK[max] ? max : s;
}

export type FindingState =
  | "detected" // raw scanner output only
  | "suspected" // multiple indicators correlate
  | "validated" // an active check demonstrated it
  | "confirmed_exploitable" // working PoC with real impact
  | "informational" // no security impact (recon, headers, banners)
  | "verification_required" // stale / needs re-check
  | "false_positive"
  | "duplicate"
  | "deprecated"
  | "dismissed";

// Recon artifacts & low/no-impact signals → INFORMATIONAL unless chained with
// real impact. This is the single biggest false-positive reducer.
const INFORMATIONAL = [
  /missing (security )?header|x-frame-options|\bhsts\b|content-security-policy|\bcsp\b|x-content-type-options|referrer-policy|permissions-policy/i,
  /robots\.txt|security\.txt|sitemap\.xml|humans\.txt|\.well-known/i,
  /^open port |open port \d+\/(tcp|udp)\b/i,
  /technology (stack|detected|fingerprint)|whatweb|wappalyzer|tech-detect|fingerprint/i,
  /version (banner|disclosure)|server header|banner grab|software version/i,
  /\bdns\b (record|enumeration)|subdomain (found|discovered)|historical url|wayback|archived url/i,
  /\b(cdn|cloudfront|cloudflare|akamai|fastly)\b (detected|fingerprint|header)/i,
  /aws (detected|fingerprint)|s3 bucket name|public (api )?docs|swagger ui present/i,
  /directory listing|autoindex/i,
];

// High-impact classes that MAY reach critical — with demonstrated impact only.
type ClassDef = { re: RegExp; label: string; baseProb: number; canBeCritical: boolean };
const CLASSES: ClassDef[] = [
  { re: /account takeover|\bato\b/i, label: "account takeover", baseProb: 99, canBeCritical: true },
  { re: /remote code execution|\brce\b|command injection|os command/i, label: "RCE", baseProb: 98, canBeCritical: true },
  { re: /authentication bypass|auth bypass|login bypass/i, label: "auth bypass", baseProb: 96, canBeCritical: true },
  { re: /\bidor\b|insecure direct object|broken (access control|authorization)|mass assignment/i, label: "IDOR / broken access", baseProb: 95, canBeCritical: true },
  { re: /sql ?injection|\bsqli\b/i, label: "SQL injection", baseProb: 93, canBeCritical: true },
  { re: /\bssrf\b|server-side request forgery|169\.254\.169\.254|metadata (endpoint|service)/i, label: "SSRF", baseProb: 88, canBeCritical: true },
  { re: /privilege escalation|priv ?esc/i, label: "privilege escalation", baseProb: 90, canBeCritical: true },
  // Modern high-value classes (2024–2025 landscape).
  { re: /oauth.{0,25}(misconfig|redirect|bypass|takeover)|redirect_uri.{0,20}(manipulation|bypass)|\boidc\b|state (parameter )?(missing|not validated|fixation)|\bpkce\b (missing|downgrade)/i, label: "OAuth/OIDC misconfiguration", baseProb: 85, canBeCritical: true },
  { re: /request smuggling|http desync|\bcl\.te\b|\bte\.cl\b|\bte\.te\b/i, label: "HTTP request smuggling", baseProb: 80, canBeCritical: true },
  { re: /race condition|\btoctou\b|limit overrun|double[- ]spend|single-packet attack/i, label: "race condition", baseProb: 78, canBeCritical: false },
  { re: /prompt injection|jailbreak|system prompt (leak|override|extract)|indirect prompt/i, label: "AI/LLM prompt injection", baseProb: 74, canBeCritical: false },
  { re: /cache poisoning|web cache (poison|deception)|cache deception/i, label: "web cache poisoning", baseProb: 72, canBeCritical: false },
  { re: /business logic|logic (flaw|bypass)|price manipulation|negative (quantity|amount|price)|coupon (abuse|stacking)/i, label: "business logic", baseProb: 70, canBeCritical: false },
  { re: /graphql.{0,25}(introspection|injection|batching|authorization)|introspection (enabled|exposed)|__schema/i, label: "GraphQL vulnerability", baseProb: 68, canBeCritical: false },
  { re: /prototype pollution|__proto__|constructor\.prototype/i, label: "prototype pollution", baseProb: 66, canBeCritical: true },
  { re: /deserial/i, label: "deserialization", baseProb: 85, canBeCritical: true },
  { re: /stored (xss|cross-site)|persistent xss/i, label: "stored XSS", baseProb: 90, canBeCritical: false },
  { re: /arbitrary file (read|access|download)|path traversal|lfi\b|local file inclusion/i, label: "file read / traversal", baseProb: 80, canBeCritical: true },
  { re: /secret(s)? (disclosure|exposure|leak)|hard-?coded (secret|credential|key)|api[_ ]?key (leak|exposed)|private key/i, label: "secret exposure", baseProb: 78, canBeCritical: true },
  { re: /reflected (xss|cross-site)/i, label: "reflected XSS", baseProb: 55, canBeCritical: false },
  { re: /\bcsrf\b|cross-site request forgery/i, label: "CSRF", baseProb: 40, canBeCritical: false },
  { re: /open redirect/i, label: "open redirect", baseProb: 25, canBeCritical: false },
  { re: /\bsmbv1\b|eternalblue|ms17-010/i, label: "legacy SMB", baseProb: 70, canBeCritical: true },
];

// Confidence band per proof level, then nudged by corroborating signals.
const BASE_CONFIDENCE = { reported: 30, validated: 65, proven: 90 } as const;

export type QualityInput = {
  title: string;
  description?: string | null;
  severity?: string | null; // scanner-proposed severity
  evidence?: string | null;
  confirmedFlag?: boolean | null;
  tool?: string | null;
  // The finding's CVE is in the CISA KEV catalog (actively exploited in the
  // wild). Resolved by a server-side caller (getKevSet) and passed in — this
  // module stays pure so client bundles never import the DB.
  knownExploited?: boolean | null;
};

export type Quality = {
  state: FindingState;
  severity: Sev; // policy-adjusted (may differ from the scanner's)
  scannerSeverity: Sev;
  confidence: number; // 0–100
  bugBountyProbability: number; // 0–100
  vulnClass: string | null;
  knownExploited: boolean; // in CISA KEV (actively exploited)
  rationale: string[];
};

function normSev(s: string | null | undefined): Sev {
  const v = (s ?? "").toLowerCase();
  return (["info", "low", "medium", "high", "critical"] as Sev[]).includes(v as Sev) ? (v as Sev) : "info";
}

function matchClass(text: string): ClassDef | null {
  for (const c of CLASSES) if (c.re.test(text)) return c;
  return null;
}

/**
 * Assess one finding under the master policy. Deterministic and conservative:
 * unknown / unproven → low confidence, capped severity, "validate first".
 */
export function assessFinding(input: QualityInput): Quality {
  const text = `${input.title ?? ""}\n${input.description ?? ""}\n${input.evidence ?? ""}`;
  const scannerSeverity = normSev(input.severity);
  const kev = !!input.knownExploited;
  const rationale: string[] = [];

  // 1. Informational / recon artifact → no security impact.
  const isInfo = INFORMATIONAL.some((re) => re.test(text));
  if (isInfo && !kev) {
    rationale.push("Recon artifact / low-impact signal — informational unless chained with real impact.");
    return {
      state: "informational",
      severity: "info",
      scannerSeverity,
      confidence: 15,
      bugBountyProbability: 1,
      vulnClass: null,
      knownExploited: false,
      rationale,
    };
  }

  // 2. Proof level → base confidence + state.
  const proof = classifyConfidence({
    title: input.title,
    description: input.description,
    evidence: input.evidence,
    confirmedFlag: input.confirmedFlag,
  });
  let confidence: number = BASE_CONFIDENCE[proof.level];
  rationale.push(`Proof level: ${proof.level} (${proof.signal}).`);

  // Freshness: kill stale, already-patched version-banner matches (the main
  // false-positive class). A version outside the fixed range → dismiss entirely;
  // a version-only CVE match → demote (validate before trusting).
  const fresh = assessFreshness({
    title: input.title,
    description: input.description,
    evidence: input.evidence,
    confirmedFlag: input.confirmedFlag,
  });
  if (fresh.verdict === "patched" && !kev) {
    return {
      state: "informational",
      severity: "info",
      scannerSeverity,
      confidence: 12,
      bugBountyProbability: 0,
      vulnClass: matchClass(text)?.label ?? null,
      knownExploited: false,
      rationale: [`Dismissed — ${fresh.reason}.`],
    };
  }
  // A version-only match is "stale" — UNLESS it's a CVE in CISA KEV (actively
  // exploited right now), which overrides the freshness dismissal: verify it
  // urgently, don't hide it, even if the version banner suggests it's patched.
  const stale = (fresh.verdict === "verify" || fresh.verdict === "patched") && !kev;
  if (stale) rationale.push(`Freshness: ${fresh.reason}`);
  if (kev && fresh.verdict !== "current") {
    rationale.push(`⚠ ${fresh.reason} — but this CVE is in CISA KEV, so verify urgently.`);
  }

  // Corroboration: a CVE id, extracted evidence, or a named class nudges confidence.
  const cls = matchClass(text);
  if (cls) {
    confidence += 5;
    rationale.push(`Recognized class: ${cls.label}.`);
  }
  if (/\bCVE-\d{4}-\d{3,7}\b/i.test(text)) confidence += 3;
  // A version-only ("verify") match is weak evidence — don't let it look confident.
  if (stale) confidence -= 12;
  confidence = Math.max(0, Math.min(100, confidence));

  // 3. State from proof level.
  let state: FindingState =
    proof.level === "proven" ? "confirmed_exploitable" : proof.level === "validated" ? "validated" : "detected";

  // 4. Severity policy: start from max(scanner, class implication), then CAP by
  //    confidence. CRITICAL requires demonstrated impact (confirmed_exploitable).
  let severity = scannerSeverity;
  if (cls && cls.canBeCritical) severity = SEV_RANK[severity] < SEV_RANK["high"] ? "high" : severity;
  if (confidence < 50) {
    severity = capSeverity(severity, "medium");
    rationale.push("Confidence < 50 → severity capped at MEDIUM.");
  } else if (confidence < 75) {
    severity = capSeverity(severity, "high");
    rationale.push("Confidence < 75 → CRITICAL not allowed.");
  }
  if (severity === "critical" && state !== "confirmed_exploitable") {
    severity = "high";
    rationale.push("CRITICAL downgraded to HIGH — no demonstrated impact (needs a working PoC).");
  }

  // 5. Bug-bounty probability: class base × a state factor (un-validated findings
  //    are much less likely to be accepted/awarded).
  const stateFactor =
    state === "confirmed_exploitable" ? 1.0 : state === "validated" ? 0.85 : 0.45;
  const base = cls ? cls.baseProb : severity === "info" ? 2 : SEV_RANK[severity] >= 3 ? 35 : 12;
  // Stale version-only matches are unlikely to be accepted — most are patched.
  const staleFactor = stale ? 0.35 : 1;
  let bugBountyProbability = Math.round(Math.max(0, Math.min(100, base * stateFactor * staleFactor)));

  if (state === "detected") rationale.push("Not yet validated — run the PoC before submitting (default: insufficient evidence).");

  // CISA KEV: actively exploited in the wild → prioritize. Floors the acceptance
  // estimate and flags it prominently, but does NOT fake proof (still needs
  // validation to become confirmed).
  if (kev) {
    bugBountyProbability = Math.max(bugBountyProbability, 60);
    rationale.push("🔥 In CISA KEV — actively exploited in the wild; prioritize.");
  }

  return {
    state,
    severity,
    scannerSeverity,
    confidence,
    bugBountyProbability,
    vulnClass: cls?.label ?? null,
    knownExploited: kev,
    rationale,
  };
}

export const STATE_LABEL: Record<FindingState, string> = {
  detected: "Detected",
  suspected: "Suspected",
  validated: "Validated",
  confirmed_exploitable: "Confirmed exploitable",
  informational: "Informational",
  verification_required: "Verification required",
  false_positive: "False positive",
  duplicate: "Duplicate",
  deprecated: "Deprecated",
  dismissed: "Dismissed",
};

/** Should automation spend a runner job trying to exploit/validate this finding?
 * No for informational/recon artifacts — that's what floods the queue. */
export function worthAutomating(input: QualityInput): boolean {
  return assessFinding(input).state !== "informational";
}

export type ReportSections<T> = {
  confirmed: (T & { quality: Quality })[]; // confirmed_exploitable
  validated: (T & { quality: Quality })[]; // validated (active check)
  suspected: (T & { quality: Quality })[]; // detected/suspected, has impact potential
  informational: (T & { quality: Quality })[]; // recon artifacts, no impact
  /** Executive risk score 0–100, computed ONLY from validated+confirmed findings
   * (informational never influences it — a core master-policy rule). */
  riskScore: number;
  counts: { confirmed: number; validated: number; suspected: number; informational: number };
};

const RISK_WEIGHT: Record<Sev, number> = { info: 0, low: 5, medium: 15, high: 35, critical: 60 };

/**
 * Group findings into the master-policy report sections and compute an executive
 * risk score from validated/confirmed findings only. Generic over the finding row
 * so callers keep their own ids/fields alongside the computed `quality`.
 */
export function groupForReport<T extends QualityInput>(findings: T[]): ReportSections<T> {
  const confirmed: (T & { quality: Quality })[] = [];
  const validated: (T & { quality: Quality })[] = [];
  const suspected: (T & { quality: Quality })[] = [];
  const informational: (T & { quality: Quality })[] = [];

  for (const f of findings) {
    const quality = assessFinding(f);
    const row = { ...f, quality };
    if (quality.state === "confirmed_exploitable") confirmed.push(row);
    else if (quality.state === "validated") validated.push(row);
    else if (quality.state === "informational") informational.push(row);
    else suspected.push(row);
  }

  // Risk: weighted by severity, validated/confirmed only, with diminishing
  // returns so one finding can't peg it. Confirmed weighs full, validated 0.7×.
  let raw = 0;
  for (const r of confirmed) raw += RISK_WEIGHT[r.quality.severity];
  for (const r of validated) raw += RISK_WEIGHT[r.quality.severity] * 0.7;
  const riskScore = Math.round(Math.min(100, 100 * (1 - Math.exp(-raw / 80))));

  return {
    confirmed,
    validated,
    suspected,
    informational,
    riskScore,
    counts: {
      confirmed: confirmed.length,
      validated: validated.length,
      suspected: suspected.length,
      informational: informational.length,
    },
  };
}
