import type { Engagement, Finding } from "@prisma/client";
import { execSummaryMarkdown } from "@/lib/ai-report";
import { groupForReport, STATE_LABEL, type Quality } from "@/lib/bb-engine";

export type EngagementWithFindings = Engagement & { findings: Finding[] };

export const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;

export function severityRank(s: string): number {
  const i = (SEVERITY_ORDER as readonly string[]).indexOf(s);
  return i === -1 ? SEVERITY_ORDER.length : i;
}

/** Findings sorted most-severe first. */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

/** Count of findings per severity (only non-zero buckets, severe first). */
export function severityCounts(findings: Finding[]): { severity: string; count: number }[] {
  return SEVERITY_ORDER.map((sev) => ({
    severity: sev,
    count: findings.filter((f) => f.severity === sev).length,
  })).filter((b) => b.count > 0);
}

function fmtDate(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

export type GradedFinding = Finding & { quality: Quality };

export type GradedSections = {
  confirmed: GradedFinding[];
  validated: GradedFinding[];
  suspected: GradedFinding[];
  informational: GradedFinding[];
  riskScore: number;
  counts: { confirmed: number; validated: number; suspected: number; informational: number };
};

/**
 * Grade an engagement's findings under the bug-bounty policy engine and bucket
 * them into report sections. Shared by the Markdown export AND the on-screen
 * report page so they never drift. Risk is from confirmed+validated only.
 */
export function gradeFindings(findings: Finding[]): GradedSections {
  type Row = {
    title: string;
    description: string;
    severity: string;
    confirmedFlag: boolean;
    _row: Finding;
  };
  const inputs: Row[] = findings.map((f) => ({
    title: f.title,
    description: f.description,
    severity: f.severity,
    confirmedFlag: f.confirmed,
    _row: f,
  }));
  const g = groupForReport(inputs);
  const withRow = (arr: (Row & { quality: Quality })[]): GradedFinding[] =>
    arr.map((x) => ({ ...x._row, quality: x.quality }));
  return {
    confirmed: withRow(g.confirmed),
    validated: withRow(g.validated),
    suspected: withRow(g.suspected),
    informational: withRow(g.informational),
    riskScore: g.riskScore,
    counts: g.counts,
  };
}

/** Render one finding block with its policy-graded state/confidence/acceptance. */
function renderFinding(f: GradedFinding, n: number, lines: string[]): void {
  const q = f.quality;
  lines.push(`### ${n}. ${f.title}`);
  lines.push("");
  lines.push(`- **Severity:** ${q.severity.toUpperCase()}${q.severity !== q.scannerSeverity ? ` _(scanner said ${q.scannerSeverity}; adjusted by policy)_` : ""}`);
  lines.push(`- **State:** ${STATE_LABEL[q.state]}`);
  lines.push(`- **Confidence:** ${q.confidence}/100`);
  if (q.state !== "informational") lines.push(`- **Est. bug-bounty acceptance:** ${q.bugBountyProbability}%${q.vulnClass ? ` (${q.vulnClass})` : ""}`);
  lines.push("");
  if (f.description) {
    lines.push("**Description**");
    lines.push("");
    lines.push(f.description);
    lines.push("");
  }
  if (f.recommendation) {
    lines.push("**Remediation**");
    lines.push("");
    lines.push(f.recommendation);
    lines.push("");
  }
}

/**
 * Render an engagement and its findings as a professional, evidence-first
 * Markdown report. Findings are graded by the bug-bounty policy engine and split
 * into Confirmed / Validated / Suspected / Informational sections. The executive
 * RISK SCORE is computed from validated+confirmed findings ONLY — informational
 * and recon artifacts never inflate it.
 */
export function buildMarkdown(e: EngagementWithFindings): string {
  const lines: string[] = [];

  // Grade + bucket every finding under the master policy.
  const g = gradeFindings(e.findings);
  const { confirmed, validated, suspected, informational } = g;

  lines.push(`# Security Assessment Report — ${e.name}`);
  lines.push("");
  lines.push(`- **Client:** ${e.client || "—"}`);
  lines.push(`- **Type:** ${e.type}`);
  lines.push(`- **Status:** ${e.status}`);
  lines.push(`- **Date:** ${fmtDate(e.createdAt)}`);
  lines.push(
    `- **Authorization:** ${
      e.authorized
        ? `Authorized${e.authorizedBy ? ` by ${e.authorizedBy}` : ""}`
        : "NOT AUTHORIZED"
    }`,
  );
  lines.push("");

  // Executive summary (its own "## Executive Summary" heading) + a risk score
  // from VALIDATED findings only.
  lines.push(execSummaryMarkdown(e));
  lines.push("");
  lines.push(`**Validated risk score:** ${g.riskScore}/100 _(computed from confirmed + validated findings only; informational/recon artifacts excluded)._`);
  lines.push("");
  lines.push("| Category | Count |");
  lines.push("| --- | --- |");
  lines.push(`| Confirmed exploitable | ${g.counts.confirmed} |`);
  lines.push(`| Validated | ${g.counts.validated} |`);
  lines.push(`| Suspected (needs validation) | ${g.counts.suspected} |`);
  lines.push(`| Informational / recon | ${g.counts.informational} |`);
  lines.push("");

  if (e.scope) {
    lines.push("## Scope");
    lines.push("");
    lines.push(e.scope);
    lines.push("");
  }

  const section = (title: string, note: string, rows: GradedFinding[]) => {
    lines.push(`## ${title}`);
    lines.push("");
    if (note) {
      lines.push(`_${note}_`);
      lines.push("");
    }
    if (rows.length === 0) {
      lines.push("_None._");
      lines.push("");
      return;
    }
    rows
      .sort((a, b) => severityRank(a.quality.severity) - severityRank(b.quality.severity))
      .forEach((f, i) => renderFinding(f, i + 1, lines));
  };

  section("Confirmed Exploitable Vulnerabilities", "A working proof-of-concept demonstrated real impact.", confirmed);
  section("Validated Vulnerabilities", "An active check demonstrated the weakness.", validated);
  section("Suspected Findings", "Detected but not yet validated — reproduce/exploit before relying on these.", suspected);

  // Informational stays terse — a list, not full write-ups (and never weighs risk).
  lines.push("## Informational & Reconnaissance Artifacts");
  lines.push("");
  if (informational.length === 0) {
    lines.push("_None._");
  } else {
    lines.push("_No direct security impact; listed for completeness. Excluded from the risk score._");
    lines.push("");
    for (const f of informational) lines.push(`- ${f.title}`);
  }
  lines.push("");

  lines.push("---");
  lines.push(
    "_Generated by RD-AISEC. Findings are graded by an evidence-first policy: a scanner detection is a hypothesis, not a confirmed vulnerability. For authorized security testing and education only._",
  );
  return lines.join("\n");
}

/** Filesystem-safe slug for the download filename. */
export function reportFilename(e: Engagement): string {
  const slug = e.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `report-${slug || e.id}.md`;
}
