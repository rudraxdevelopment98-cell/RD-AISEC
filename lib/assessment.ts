// Standard assessment result schema + report-time analytics.
//
// Turns the portal's raw findings into the structured, evidence-first result
// rows an operator expects from a professional assessment — plus the three
// executive tables (Dashboard, Asset Summary, Remediation Roadmap) and a
// non-destructive correlation/dedup pass.
//
// Pure by design: no prisma / server imports. It consumes plain finding-shaped
// objects + their policy `Quality` (from lib/bb-engine), so it is client-safe
// AND unit testable. NOTHING here mutates stored data — correlation collapses
// duplicates for DISPLAY only, so the ingestion pipeline is never touched.

import type { Quality } from "@/lib/bb-engine";

/** Minimum finding shape this module needs (a Prisma Finding satisfies it). */
export type FindingLike = {
  id: string;
  title: string;
  description: string;
  severity: string;
  recommendation?: string | null;
  attack?: string | null;
  owasp?: string | null;
  confirmed?: boolean;
  createdAt?: Date | string | null;
};

export type Sev = "critical" | "high" | "medium" | "low" | "info";
const SEV_ORDER: Sev[] = ["critical", "high", "medium", "low", "info"];
export function sevRank(s: string): number {
  const i = (SEV_ORDER as string[]).indexOf(s);
  return i === -1 ? SEV_ORDER.length : i;
}

/** Representative CVSS band for a severity (used only when no vector is parsed). */
const CVSS_BAND: Record<Sev, string> = {
  critical: "9.0–10.0",
  high: "7.0–8.9",
  medium: "4.0–6.9",
  low: "0.1–3.9",
  info: "0.0",
};

const CVE_RE = /\bCVE-\d{4}-\d{3,7}\b/i;
// e.g. "CVSS:3.1/AV:N/..." or "CVSS 9.8" or "score 9.8"
const CVSS_SCORE_RE = /\bcvss[:\s]*(?:3\.\d\/[A-Z:/.]+\s*)?(\d{1,2}\.\d)\b/i;

/** Pull a host/URL "affected asset" out of a finding's text. */
export function extractAsset(f: FindingLike): string {
  const text = `${f.title} ${f.description}`;
  const url = text.match(/\bhttps?:\/\/[^\s"'<>)\]]+/i)?.[0];
  if (url) {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }
  // host:port or bare host / IPv4
  const host = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/)?.[0]
    || text.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\b/i)?.[0];
  return host || "unspecified";
}

/** Detection method, inferred from the finding's provenance markers. */
function detectionMethod(f: FindingLike): string {
  const t = `${f.title} ${f.description}`.toLowerCase();
  if (f.confirmed) return "Manual exploitation / proof-of-concept";
  if (/nuclei|template/.test(t)) return "Template scan (nuclei)";
  if (/nmap|masscan|port/.test(t)) return "Network/port scan";
  if (/httpx|http probe|status code/.test(t)) return "HTTP probe";
  if (/sqlmap|sql injection/.test(t)) return "SQL-injection scan";
  if (/dalfox|xss/.test(t)) return "XSS scan";
  if (/source|repo|code|static/.test(t)) return "Static/source analysis";
  if (/secret|api key|token leak/.test(t)) return "Secret detection";
  return "Automated scan";
}

/** Plain-language business impact, keyed off severity + class. */
function businessImpact(sev: Sev, vulnClass: string | null, kev: boolean): string {
  if (kev) return "Actively exploited in the wild (CISA KEV) — treat as imminent, real-world risk.";
  const cls = (vulnClass || "").toLowerCase();
  if (/rce|command|deserial/.test(cls)) return "Full system compromise — attacker can run code on the host.";
  if (/sqli|injection/.test(cls)) return "Database compromise — data theft, tampering, or auth bypass.";
  if (/idor|access control|authorization/.test(cls)) return "Unauthorized access to other users' data or actions.";
  if (/ssrf/.test(cls)) return "Pivot into internal systems / cloud metadata theft.";
  if (/xss/.test(cls)) return "Session hijack / action-on-behalf-of a victim user.";
  if (/secret|credential/.test(cls)) return "Leaked credentials enable direct account or infra takeover.";
  switch (sev) {
    case "critical": return "Severe — likely direct loss of confidentiality, integrity, or availability.";
    case "high": return "Significant — meaningful exposure requiring prompt remediation.";
    case "medium": return "Moderate — exploitable under specific conditions; fix in normal cycle.";
    case "low": return "Minor — limited impact; address opportunistically.";
    default: return "Informational — no direct security impact.";
  }
}

/** Likely root cause, keyed off class. */
function rootCause(vulnClass: string | null): string {
  const cls = (vulnClass || "").toLowerCase();
  if (/rce|command/.test(cls)) return "Untrusted input reaches a command/interpreter without sanitisation.";
  if (/sqli|injection/.test(cls)) return "User input concatenated into a query instead of parameterised.";
  if (/idor|access control|authorization/.test(cls)) return "Missing per-object authorization check on a request.";
  if (/ssrf/.test(cls)) return "Server fetches a user-supplied URL without allow-listing.";
  if (/xss/.test(cls)) return "Output rendered without context-aware encoding.";
  if (/secret|credential/.test(cls)) return "Secret committed to code / exposed in a response or artifact.";
  if (/outdated|version|cve/.test(cls)) return "Dependency or service running a version with a known flaw.";
  return "Weakness in input handling, configuration, or access control.";
}

/** A verification procedure the reviewer can follow to confirm the fix. */
function verification(vulnClass: string | null, asset: string): string {
  const cls = (vulnClass || "").toLowerCase();
  if (/idor|access control|authorization/.test(cls))
    return `Re-request the affected object on ${asset} with a DIFFERENT user's session — a fixed target returns 403/404, not the object.`;
  if (/sqli|injection/.test(cls))
    return `Re-run the injection payload against ${asset}; a fixed target returns a normal error with no query-level difference between true/false payloads.`;
  if (/xss/.test(cls))
    return `Re-submit the XSS payload to ${asset}; confirm it is rendered as inert text (encoded), not executed.`;
  if (/rce|command/.test(cls))
    return `Re-run the command payload against ${asset}; confirm no command output and no out-of-band callback.`;
  return `Re-run the original detection against ${asset} after the fix and confirm the signal is gone.`;
}

/** Recommended fix — the finding's own guidance, else a class default. */
function recommendedFix(f: FindingLike, vulnClass: string | null): string {
  if (f.recommendation && f.recommendation.trim()) return f.recommendation.trim();
  const cls = (vulnClass || "").toLowerCase();
  if (/rce|command/.test(cls)) return "Avoid shelling out with user input; use safe APIs and strict allow-lists.";
  if (/sqli|injection/.test(cls)) return "Use parameterised queries / prepared statements everywhere.";
  if (/idor|access control|authorization/.test(cls)) return "Enforce a per-object ownership check on every request server-side.";
  if (/ssrf/.test(cls)) return "Allow-list outbound hosts; block internal ranges and metadata endpoints.";
  if (/xss/.test(cls)) return "Apply context-aware output encoding; set a strict CSP.";
  if (/secret|credential/.test(cls)) return "Rotate the exposed secret and move it to a secrets manager.";
  if (/outdated|version|cve/.test(cls)) return "Upgrade the affected component to a fixed release.";
  return "Remediate per the finding details and re-test.";
}

export type AssessmentRow = {
  findingId: string;
  title: string;
  category: string;
  severity: Sev;
  confidence: number;
  cvss: string;
  cve: string | null;
  affectedAsset: string;
  discoveryTime: string | null;
  detectionMethod: string;
  businessImpact: string;
  rootCause: string;
  recommendedFix: string;
  verification: string;
  status: string;
  knownExploited: boolean;
};

/** Map one finding + its policy Quality into the standard result schema. */
export function toAssessmentRow(f: FindingLike, q: Quality): AssessmentRow {
  const text = `${f.title}\n${f.description}`;
  const cve = text.match(CVE_RE)?.[0]?.toUpperCase() ?? null;
  const parsedCvss = text.match(CVSS_SCORE_RE)?.[1];
  const asset = extractAsset(f);
  return {
    findingId: f.id.slice(0, 8),
    title: f.title,
    category: q.vulnClass || (f.owasp ? `OWASP ${f.owasp}` : "General"),
    severity: q.severity as Sev,
    confidence: q.confidence,
    cvss: parsedCvss ? parsedCvss : CVSS_BAND[q.severity as Sev],
    cve,
    affectedAsset: asset,
    discoveryTime: f.createdAt ? new Date(f.createdAt).toISOString().slice(0, 16).replace("T", " ") : null,
    detectionMethod: detectionMethod(f),
    businessImpact: businessImpact(q.severity as Sev, q.vulnClass, q.knownExploited),
    rootCause: rootCause(q.vulnClass),
    recommendedFix: recommendedFix(f, q.vulnClass),
    verification: verification(q.vulnClass, asset),
    status: q.state,
    knownExploited: q.knownExploited,
  };
}

// ── Correlation / dedup (display-only) ─────────────────────────────────────

/** Normalise a title for near-duplicate matching. */
function normTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/\bcve-\d{4}-\d{3,7}\b/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type Cluster = {
  key: string;
  primary: AssessmentRow;
  occurrences: number;
  assets: string[];
};

/**
 * Correlate rows into clusters keyed by (vuln class OR normalised title). The
 * highest-severity, highest-confidence row becomes the cluster's representative;
 * the rest are counted as additional occurrences across assets. Purely for
 * report display — the underlying findings are untouched.
 */
export function correlate(rows: AssessmentRow[]): Cluster[] {
  const groups = new Map<string, AssessmentRow[]>();
  for (const r of rows) {
    const key = `${r.category}::${normTitle(r.title)}`;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  const clusters: Cluster[] = [];
  for (const [key, arr] of groups) {
    const sorted = [...arr].sort(
      (a, b) => sevRank(a.severity) - sevRank(b.severity) || b.confidence - a.confidence,
    );
    const assets = Array.from(new Set(arr.map((r) => r.affectedAsset))).filter((a) => a !== "unspecified");
    clusters.push({ key, primary: sorted[0], occurrences: arr.length, assets });
  }
  return clusters.sort(
    (a, b) => sevRank(a.primary.severity) - sevRank(b.primary.severity) || b.primary.confidence - a.primary.confidence,
  );
}

// ── Executive tables ───────────────────────────────────────────────────────

export type AssetRollup = {
  asset: string;
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  topSeverity: Sev;
};

/** Per-asset severity roll-up, worst assets first. */
export function assetSummary(rows: AssessmentRow[]): AssetRollup[] {
  const map = new Map<string, AssetRollup>();
  for (const r of rows) {
    const a = r.affectedAsset || "unspecified";
    const cur = map.get(a) ?? {
      asset: a, total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0, topSeverity: "info" as Sev,
    };
    cur.total += 1;
    cur[r.severity] += 1;
    if (sevRank(r.severity) < sevRank(cur.topSeverity)) cur.topSeverity = r.severity;
    map.set(a, cur);
  }
  return Array.from(map.values()).sort(
    (x, y) => sevRank(x.topSeverity) - sevRank(y.topSeverity) || y.total - x.total,
  );
}

export type RoadmapItem = {
  priority: number;
  title: string;
  severity: Sev;
  asset: string;
  fix: string;
  effort: "Quick" | "Moderate" | "Involved";
  when: string;
};

/** Rough remediation effort from vuln class. */
function effortFor(category: string): RoadmapItem["effort"] {
  const c = category.toLowerCase();
  if (/secret|credential|header|config|version|outdated|tls|ssl/.test(c)) return "Quick";
  if (/idor|access control|authorization|rce|command|deserial/.test(c)) return "Involved";
  return "Moderate";
}

/** Prioritised remediation roadmap (severity → confidence). */
export function remediationRoadmap(rows: AssessmentRow[]): RoadmapItem[] {
  const ranked = [...rows]
    .filter((r) => r.status !== "informational" && r.severity !== "info")
    .sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || b.confidence - a.confidence);
  return ranked.map((r, i) => ({
    priority: i + 1,
    title: r.title,
    severity: r.severity,
    asset: r.affectedAsset,
    fix: r.recommendedFix,
    effort: effortFor(r.category),
    when:
      r.knownExploited || r.severity === "critical"
        ? "Immediate (24–72h)"
        : r.severity === "high"
          ? "This sprint (≤1 week)"
          : r.severity === "medium"
            ? "This cycle (≤30 days)"
            : "Backlog",
  }));
}

export type Dashboard = {
  total: number;
  bySeverity: Record<Sev, number>;
  confirmed: number;
  validated: number;
  suspected: number;
  informational: number;
  knownExploited: number;
  assets: number;
  avgConfidence: number;
};

/** Executive dashboard totals across all rows. */
export function executiveDashboard(rows: AssessmentRow[]): Dashboard {
  const bySeverity: Record<Sev, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  let confirmed = 0, validated = 0, suspected = 0, informational = 0, kev = 0, confSum = 0;
  const assets = new Set<string>();
  for (const r of rows) {
    bySeverity[r.severity] += 1;
    assets.add(r.affectedAsset);
    confSum += r.confidence;
    if (r.knownExploited) kev += 1;
    if (r.status === "confirmed_exploitable") confirmed += 1;
    else if (r.status === "validated") validated += 1;
    else if (r.status === "informational") informational += 1;
    else suspected += 1;
  }
  return {
    total: rows.length,
    bySeverity,
    confirmed,
    validated,
    suspected,
    informational,
    knownExploited: kev,
    assets: assets.size,
    avgConfidence: rows.length ? Math.round(confSum / rows.length) : 0,
  };
}
