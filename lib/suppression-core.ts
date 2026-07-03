// Learned false-positive suppression — pure core (no DB/IO), so it's testable
// and shared by the import gate + the server actions.
//
// The idea: you can't paste every bad finding. Instead, when you mark a finding
// as a false positive, we derive a stable SIGNATURE from it (its vuln class + a
// normalized title, tool-agnostic) and remember it. On every future import we
// match new candidates against these learned rules and drop the ones you already
// told us are noise — the system improves itself from your triage.

import { classifyFindingVuln } from "./vuln-taxonomy";

export type Signature = {
  vulnClass: string; // taxonomy class id ("" if unclassified)
  titleKey: string; // normalized, host/number/CVE-stripped title
};

export type SuppressionRule = Signature & {
  id?: string;
  kind?: string; // "suppress" (drop) | "allow" (protect)
  scope?: string; // "global" | "host"
  host?: string; // set when scope === "host"
  tool?: string; // "" = any tool
};

/**
 * Normalize a finding title into a stable key that's the same across hosts and
 * scan runs: lowercased, with the "on <host>" tail, parentheticals, CVE ids,
 * version numbers and symbols stripped. So "Weak TLS ciphers accepted on
 * a.com (3)" and "…on b.com (7)" both become "weak tls ciphers accepted".
 */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\bon\s+[^\s(]+/g, "") // "on host.com"
    .replace(/\([^)]*\)/g, "") // "(3)" counts / parentheticals
    .replace(/cve-\d{4}-\d+/gi, "") // CVE ids
    .replace(/\b[\d][\d.]*\b/g, "") // version numbers / counts
    .replace(/[^a-z0-9\s-]/g, " ") // emojis/symbols → space
    .replace(/\s+/g, " ")
    .trim();
}

/** Derive the suppression signature for a finding. */
export function signatureOf(finding: {
  title: string;
  description?: string | null;
}): Signature {
  const cls = classifyFindingVuln({
    title: finding.title,
    description: finding.description ?? "",
  });
  return { vulnClass: cls?.id ?? "", titleKey: titleKey(finding.title) };
}

/** Does a finding (with known tool/host) match a learned suppression rule? */
export function matchesRule(
  finding: { title: string; description?: string | null; tool?: string; host?: string },
  rule: SuppressionRule,
): boolean {
  // Tool gate (rule.tool "" = any).
  if (rule.tool && finding.tool && rule.tool !== finding.tool) return false;
  // Host gate for host-scoped rules.
  if (rule.scope === "host" && rule.host && finding.host && rule.host !== finding.host) {
    return false;
  }
  const sig = signatureOf(finding);
  // Class must agree when the rule specifies one; title key must equal.
  if (rule.vulnClass && sig.vulnClass && rule.vulnClass !== sig.vulnClass) return false;
  return !!rule.titleKey && rule.titleKey === sig.titleKey;
}

/** First matching rule, or null. */
export function firstMatch(
  finding: { title: string; description?: string | null; tool?: string; host?: string },
  rules: SuppressionRule[],
): SuppressionRule | null {
  for (const r of rules) if (matchesRule(finding, r)) return r;
  return null;
}

/** Partition candidate findings into kept vs suppressed (with the rule hit). */
export function filterSuppressed<T extends { title: string; description?: string | null }>(
  findings: T[],
  rules: SuppressionRule[],
  ctx: { tool?: string; host?: string } = {},
): { kept: T[]; suppressed: { finding: T; ruleId?: string }[] } {
  if (rules.length === 0) return { kept: findings, suppressed: [] };
  const allow = rules.filter((r) => r.kind === "allow");
  const suppress = rules.filter((r) => r.kind !== "allow");
  const kept: T[] = [];
  const suppressed: { finding: T; ruleId?: string }[] = [];
  for (const f of findings) {
    const cand = { ...f, tool: ctx.tool, host: ctx.host };
    // A class you've CONFIRMED as real is protected — allow always wins.
    if (firstMatch(cand, allow)) {
      kept.push(f);
      continue;
    }
    const r = firstMatch(cand, suppress);
    if (r) suppressed.push({ finding: f, ruleId: r.id });
    else kept.push(f);
  }
  return { kept, suppressed };
}

/** Extract a host from a finding title's "… on <host>" tail (for host scoping). */
export function hostFromTitle(title: string): string {
  const m = title.match(/\bon\s+([a-z0-9.:_-]+)/i);
  return m ? m[1].toLowerCase() : "";
}
