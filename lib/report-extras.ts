// Report sections for the non-pentest disciplines — pure builders that fold the
// consulting assessment posture and the forensics evidence/chain-of-custody into
// the same deliverable as the findings. Used by both the on-screen/print report
// and the Markdown export.

import { scoreControls, statusLabel, FRAMEWORKS, type Scored } from "@/lib/consulting-core";

export type RCtrl = {
  controlId: string; domain: string; title: string;
  status: string; maturity: number; notes: string; recommendation: string;
};
export type RAssessment = { id: string; name: string; framework: string; controls: RCtrl[] };
export type REvidence = {
  id: string; name: string; kind: string; hashAlgo: string; hashValue: string;
  source: string; storage: string; acquiredBy: string; acquiredAt: Date;
  custody: { action: string; actor: string; at: Date; notes: string }[];
};

export function frameworkName(id: string): string {
  return FRAMEWORKS.find((f) => f.id === id)?.name ?? id;
}

const gapRank = (st: string) => (st === "fail" ? 0 : st === "partial" ? 1 : 2);

/** Prepared assessment for HTML: score + the actionable (fail/partial) controls. */
export function prepAssessment(a: RAssessment): { id: string; name: string; framework: string; score: Scored; gaps: RCtrl[] } {
  const score = scoreControls(a.controls);
  const gaps = a.controls
    .filter((c) => c.status === "fail" || c.status === "partial")
    .sort((x, y) => gapRank(x.status) - gapRank(y.status));
  return { id: a.id, name: a.name, framework: a.framework, score, gaps };
}

function fmt(d: Date): string {
  return new Date(d).toISOString().slice(0, 16).replace("T", " ");
}

/** Markdown for the consulting posture section (empty string if no assessments). */
export function assessmentMarkdown(assessments: RAssessment[]): string {
  if (!assessments.length) return "";
  const L: string[] = ["## Security Posture Assessment", ""];
  for (const a of assessments) {
    const s = scoreControls(a.controls);
    L.push(`### ${a.name} — ${frameworkName(a.framework)}`, "");
    L.push(`**Posture score:** ${s.score}/100  ·  **Avg. maturity:** ${s.maturityAvg.toFixed(1)}/5  ·  ${s.pass} pass / ${s.partial} partial / ${s.fail} fail / ${s.na} n/a`, "");
    if (s.byDomain.length > 1) {
      L.push("| Domain | Score | Pass | Partial | Fail |", "| --- | --- | --- | --- | --- |");
      for (const d of s.byDomain) L.push(`| ${d.domain} | ${d.score}% | ${d.pass} | ${d.partial} | ${d.fail} |`);
      L.push("");
    }
    const gaps = a.controls.filter((c) => c.status === "fail" || c.status === "partial").sort((x, y) => gapRank(x.status) - gapRank(y.status));
    if (gaps.length) {
      L.push("**Gaps & recommendations**", "", "| Control | Status | Recommendation |", "| --- | --- | --- |");
      for (const c of gaps) L.push(`| ${c.title} | ${statusLabel(c.status)} | ${(c.recommendation || "—").replace(/\|/g, "\\|")} |`);
      L.push("");
    }
  }
  return L.join("\n");
}

/** Markdown for the forensics evidence + chain-of-custody section. */
export function evidenceMarkdown(evidence: REvidence[]): string {
  if (!evidence.length) return "";
  const L: string[] = ["## Evidence & Chain of Custody", ""];
  L.push("| Item | Type | Integrity | Source | Acquired |", "| --- | --- | --- | --- | --- |");
  for (const e of evidence) {
    const h = e.hashValue ? `${e.hashAlgo}:${e.hashValue.slice(0, 12)}…` : "— (no hash)";
    L.push(`| ${e.name} | ${e.kind} | ${h} | ${e.source || "—"} | ${e.acquiredBy || "—"} · ${fmt(e.acquiredAt)} |`);
  }
  L.push("");
  for (const e of evidence) {
    if (!e.custody?.length) continue;
    L.push(`**Custody — ${e.name}**`, "");
    for (const c of e.custody) L.push(`- ${fmt(c.at)} — **${c.action}** by ${c.actor || "—"}${c.notes ? `: ${c.notes}` : ""}`);
    L.push("");
  }
  return L.join("\n");
}
