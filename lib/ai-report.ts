// AI Report Writer — drafts an executive summary from an engagement's findings.
//
// Today this is a DETERMINISTIC synthesis (no external AI, works offline): it
// reads the findings and writes a professional risk narrative + prioritized
// recommendations. It's structured so a Claude pass can later replace/expand the
// narrative (see the stub at the bottom) without changing callers.
//
// Type-only import of EngagementWithFindings keeps this free of a runtime import
// from lib/report (which imports back here), so there's no import cycle.
import type { EngagementWithFindings } from "@/lib/report";

const SEV_ORDER = ["critical", "high", "medium", "low", "info"] as const;
function rank(s: string): number {
  const i = (SEV_ORDER as readonly string[]).indexOf(s);
  return i === -1 ? SEV_ORDER.length : i;
}

export type ExecRating = "Critical" | "High" | "Elevated" | "Low" | "Resolved" | "Informational";

// Recon INVENTORY, not vulnerabilities: crawled-URL lists, discovered subdomains,
// open-port lists, hidden-parameter discovery. These are the raw surface a hunter
// works FROM — never the report's headline. A professional report must not lead
// with "gau URLs on x.com (1014)" as a key risk, so they're excluded from the
// rating, key risks and recommendations (they still appear in the recon appendix).
const RECON_ARTIFACT_RE =
  /\bURLs on\b|surfaced \d+ URL|discovered \d+ (?:URL|endpoint)|\bsubdomains?\b.*(discovered|found|enumerated)|hidden parameters? (discovered|found)|\bopen port\b|port \d+\/(tcp|udp).*open|endpoint(s)? discovered|link discovery|crawl(ed)? (results|urls)/i;

export function isReconArtifact(f: { title?: string; category?: string; description?: string }): boolean {
  const cat = (f.category || "").toLowerCase();
  if (cat === "recon" || cat === "inventory" || cat === "osint") return true;
  return RECON_ARTIFACT_RE.test(`${f.title ?? ""} ${f.description ?? ""}`);
}

export type ExecSummary = {
  rating: ExecRating;
  paragraphs: string[];
  keyRisks: { title: string; severity: string; status: string }[];
  recommendations: string[];
  source: "generated" | "claude";
};

function ratingFor(openBySev: Record<string, number>, totalFindings: number, open: number): ExecRating {
  if (totalFindings === 0) return "Informational";
  if (open === 0) return "Resolved";
  if (openBySev.critical > 0) return "Critical";
  if (openBySev.high > 0) return "High";
  if (openBySev.medium > 0) return "Elevated";
  return "Low";
}

function plural(n: number, w: string): string {
  return `${n} ${w}${n === 1 ? "" : "s"}`;
}

/** Build a structured executive summary from an engagement's findings. */
export function buildExecutiveSummary(e: EngagementWithFindings): ExecSummary {
  const findings = e.findings ?? [];
  const openFindings = findings.filter((f) => f.status === "open");
  const open = openFindings.length;

  // Separate real security findings from recon INVENTORY — the rating, key risks
  // and recommendations are driven ONLY by real findings, so the report never
  // headlines a crawled-URL list as a "high risk".
  const realOpen = openFindings.filter((f) => !isReconArtifact(f));
  const reconOpen = open - realOpen.length;
  const confirmedOpen = realOpen.filter((f) => f.confirmed).length;

  const openBySev: Record<string, number> = {};
  for (const s of SEV_ORDER) openBySev[s] = realOpen.filter((f) => f.severity === s).length;

  const rating = ratingFor(openBySev, realOpen.length, realOpen.length);

  const target = e.scope?.trim() ? e.scope.trim().split(/[\n,]/)[0].trim() : (e.client || "the in-scope assets");

  const paragraphs: string[] = [];

  // 1. Overview — count real findings, not the recon flood.
  paragraphs.push(
    `This ${e.type} engagement${e.client ? ` for ${e.client}` : ""} assessed ${target}. ` +
      (realOpen.length > 0
        ? `It identified ${plural(realOpen.length, "security finding")}` +
          (confirmedOpen > 0 ? ` (${confirmedOpen} confirmed)` : "") +
          `${reconOpen > 0 ? `, alongside ${plural(reconOpen, "recon-inventory item")} (crawled URLs, subdomains, ports) catalogued in the appendix` : ""}.`
        : reconOpen > 0
          ? `No confirmed security findings were identified; ${plural(reconOpen, "recon-inventory item")} were catalogued for follow-up testing.`
          : "No findings were recorded."),
  );

  // 2. Risk posture
  if (realOpen.length === 0) {
    paragraphs.push(
      reconOpen > 0
        ? "No exploitable issues were confirmed in this pass — the recorded items are reconnaissance surface, not vulnerabilities. Prioritise manual testing of the highest-value endpoints in the appendix (auth, object references, SSRF-reachable params)."
        : "No findings have been logged yet. Run the planned tests and import results to populate this summary.",
    );
  } else if (open === 0) {
    paragraphs.push(
      "All recorded issues have been remediated or accepted, so the current residual risk is low. The original findings are retained below for the audit trail.",
    );
  } else {
    const hi = [
      openBySev.critical ? plural(openBySev.critical, "critical") : "",
      openBySev.high ? plural(openBySev.high, "high") : "",
      openBySev.medium ? plural(openBySev.medium, "medium") : "",
    ].filter(Boolean);
    paragraphs.push(
      `The overall risk posture is rated ${rating}. ` +
        (hi.length
          ? `The security findings include ${hi.join(", ")} severity ${hi.length === 1 ? "issue" : "issues"}, which should be prioritised for remediation. `
          : "The security findings are low severity. ") +
        "Per-finding detail follows in the body of this report.",
    );
  }

  // 3. Authorization caution
  if (!e.authorized) {
    paragraphs.push(
      "⚠ This engagement is not marked as authorized. Confirm written authorization and scope before issuing this report or acting on its findings.",
    );
  }

  // Key risks: REAL findings only, confirmed-first then by severity, top 5.
  const keyRisks = [...realOpen]
    .sort((a, b) => (a.confirmed === b.confirmed ? rank(a.severity) - rank(b.severity) : a.confirmed ? -1 : 1))
    .slice(0, 5)
    .map((f) => ({ title: f.title, severity: f.severity, status: f.confirmed ? "confirmed" : f.status }));

  // Recommendations: unique, from REAL findings, confirmed-first, top 6.
  const seen = new Set<string>();
  const recommendations: string[] = [];
  for (const f of [...realOpen].sort((a, b) => (a.confirmed === b.confirmed ? rank(a.severity) - rank(b.severity) : a.confirmed ? -1 : 1))) {
    const r = (f.recommendation || "").trim();
    const keyR = r.toLowerCase();
    if (r && !seen.has(keyR)) {
      seen.add(keyR);
      recommendations.push(r);
    }
    if (recommendations.length >= 6) break;
  }
  if (recommendations.length === 0) {
    recommendations.push(
      reconOpen > 0
        ? "No confirmed vulnerabilities to remediate yet. Manually test the highest-value endpoints in the recon appendix (object references → IDOR, URL/redirect params → SSRF, admin/API routes → access control)."
        : "Triage each open finding, assign an owner, and define a remediation timeline by severity.",
    );
  }

  return { rating, paragraphs, keyRisks, recommendations, source: "generated" };
}

/** Render the executive summary as Markdown (used in the downloadable report). */
export function execSummaryMarkdown(e: EngagementWithFindings): string {
  const s = buildExecutiveSummary(e);
  const lines: string[] = [];
  lines.push("## Executive Summary");
  lines.push("");
  lines.push(`**Overall risk rating: ${s.rating}**`);
  lines.push("");
  for (const p of s.paragraphs) {
    lines.push(p);
    lines.push("");
  }
  if (s.keyRisks.length) {
    lines.push("**Key risks**");
    lines.push("");
    for (const r of s.keyRisks) lines.push(`- _(${r.severity})_ ${r.title}`);
    lines.push("");
  }
  if (s.recommendations.length) {
    lines.push("**Prioritized recommendations**");
    lines.push("");
    s.recommendations.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Real Claude pass (hybrid mode) — enable by:
 *   1) npm install @anthropic-ai/sdk
 *   2) set ANTHROPIC_API_KEY
 *   3) call this from buildExecutiveSummary when the key is present.
 *
 * Feed it the deterministic summary above as grounding so Claude POLISHES real
 * data rather than inventing findings:
 *
 *   const client = new Anthropic();
 *   const res = await client.messages.create({
 *     model: "claude-opus-4-8",
 *     max_tokens: 4000,
 *     thinking: { type: "adaptive" },
 *     system: "You are a senior security consultant writing an executive summary " +
 *       "for an AUTHORIZED assessment. Use ONLY the provided findings; do not invent issues.",
 *     messages: [{ role: "user", content: groundingFromFindings }],
 *   });
 */
