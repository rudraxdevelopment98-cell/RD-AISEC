// Engine report — turns the prioritized intel into a client-ready Markdown
// remediation report (exec summary + ranked findings with risk rationale and fix
// plan). Pure, unit-tested. The UI offers it as a downloadable file.

import type { RiskScore, Tier } from "@/lib/engine/risk-core";
import type { Enrichment } from "@/lib/engine/engine-core";
import { remediationPlan } from "@/lib/engine/remediation-core";

export type ReportItem = {
  title: string;
  description?: string;
  severity: string;
  asset: string;
  engagementName?: string;
  risk: RiskScore;
  enrich: Enrichment;
};

export type ReportSummary = { tiers: Record<Tier, number>; index: number; kev: number; confirmed: number; total: number };

/** Build a prioritized remediation report as Markdown. */
export function engineReportMarkdown(items: ReportItem[], summary: ReportSummary, opts: { limit?: number } = {}): string {
  const limit = opts.limit ?? 50;
  const now = new Date().toISOString().slice(0, 16).replace("T", " ");
  const L: string[] = [];

  L.push("# Engine — Prioritized Remediation Report");
  L.push("");
  L.push(`_Generated ${now} UTC · RD-AISEC engine_`);
  L.push("");
  L.push("## Executive summary");
  L.push("");
  L.push(`- **Portfolio risk index:** ${summary.index}/100`);
  L.push(`- **Findings analyzed:** ${summary.total}`);
  L.push(`- **P1 (fix now):** ${summary.tiers.P1} · **P2:** ${summary.tiers.P2} · **P3:** ${summary.tiers.P3} · **P4:** ${summary.tiers.P4}`);
  L.push(`- **Actively exploited (KEV):** ${summary.kev} · **Proven exploitable:** ${summary.confirmed}`);
  L.push("");
  L.push("Findings below are ranked by composite risk (technical severity + proven exploitability + real-world exploit signals + exposure). Address P1s within their SLA first.");
  L.push("");
  L.push("## Prioritized findings");
  L.push("");

  const top = items.slice(0, limit);
  top.forEach((it, i) => {
    const plan = remediationPlan({ title: it.title, description: it.description, severity: it.severity });
    L.push(`### ${i + 1}. [${it.risk.tier}] ${it.title}`);
    L.push("");
    L.push(`- **Risk score:** ${it.risk.score}/100 (${it.risk.tierLabel}) · **SLA:** ${it.risk.sla}`);
    L.push(`- **Asset:** \`${it.asset || "—"}\`${it.engagementName ? ` · **Engagement:** ${it.engagementName}` : ""}`);
    L.push(`- **Class:** ${it.enrich.classLabel}${it.enrich.cwe ? ` · ${it.enrich.cwe}` : ""}${it.enrich.owasp ? ` · ${it.enrich.owasp}` : ""}${it.enrich.cve ? ` · ${it.enrich.cve}` : ""}`);
    L.push(`- **Signals:** CVSS ${it.risk.cvss.toFixed(1)}${it.risk.epss != null ? ` · EPSS ${(it.risk.epss * 100).toFixed(0)}%` : ""}${it.risk.knownExploited ? " · 🔥 KEV" : ""} · exposure: ${it.risk.exposure}`);
    L.push("");
    L.push(`**Why this ranks here:** ${it.risk.factors.map((f) => `${f.label} (${f.delta >= 0 ? "+" : ""}${f.delta})`).join(", ")}.`);
    L.push("");
    L.push(`**Root cause:** ${plan.rootCause}`);
    L.push("");
    L.push(`**Fix (${plan.effort}):**`);
    plan.fixSteps.forEach((s) => L.push(`1. ${s}`));
    L.push("");
    if (plan.snippet) {
      L.push(`_${plan.snippet.label}:_`);
      L.push("```" + plan.snippet.lang);
      L.push(plan.snippet.code);
      L.push("```");
      L.push("");
    }
    L.push(`**Verify:** ${plan.verifySteps.join(" ")}`);
    L.push("");
    if (plan.references.length) {
      L.push(`**References:** ${plan.references.map((r) => `[${r.label}](${r.url})`).join(" · ")}`);
      L.push("");
    }
    L.push("---");
    L.push("");
  });

  if (items.length > limit) {
    L.push(`_…and ${items.length - limit} more findings (P3/P4). Full data available in the Engine console._`);
    L.push("");
  }
  L.push("> For authorized security testing only. Validate each fix in a non-production environment first.");
  return L.join("\n");
}
