import "server-only";

import { prisma } from "@/lib/db";
import { getKevSet, getEpssMap } from "@/lib/threat-intel";
import { scoreFinding } from "@/lib/engine/risk-core";
import { correlateChains, type ChainFinding } from "@/lib/engine/chain-core";

const CVE_RE = /\bCVE-\d{4}-\d{3,7}\b/gi;

export type IntelFields = { kev: boolean; epss: number | null; risk: number };

type Enrichable = {
  title: string;
  description?: string | null;
  severity: string;
  confirmed?: boolean;
  status?: string | null;
  category?: string | null;
};

/** All distinct CVE ids in a finding's text, upper-cased. */
function cvesIn(f: Enrichable): string[] {
  const text = `${f.title}\n${f.description ?? ""}`;
  return [...new Set((text.match(CVE_RE) ?? []).map((c) => c.toUpperCase()))];
}

/**
 * Stamp real threat intel + a risk score on findings, using the synced CISA KEV
 * catalog and EPSS feed. Multi-CVE aware (fixes the old "first CVE only" gap):
 *   • kev  = ANY of the finding's CVEs is actively exploited (in KEV)
 *   • epss = the MAX predicted-exploitation probability across its CVEs
 *   • risk = the 0..100 engine risk score (KEV/EPSS/exposure/proof-weighted)
 *
 * Best-effort and pure-ish: if the feeds aren't synced yet the KEV/EPSS inputs
 * are empty and scoreFinding degrades gracefully (still returns a CVSS-based
 * score, and its text fallback still catches "actively exploited" phrasing).
 */
export async function enrichFindingsIntel<T extends Enrichable>(
  findings: T[],
): Promise<(T & IntelFields)[]> {
  if (findings.length === 0) return [];
  const [kevSet, epssMap] = await Promise.all([getKevSet(), getEpssMap()]);
  return findings.map((f) => {
    const cves = cvesIn(f);
    const kev = cves.some((c) => kevSet.has(c));
    let epss: number | null = null;
    for (const c of cves) {
      const e = epssMap.get(c);
      if (e != null) epss = epss == null ? e : Math.max(epss, e);
    }
    const risk = scoreFinding({
      title: f.title,
      description: f.description,
      severity: f.severity,
      confirmed: f.confirmed,
      status: f.status,
      category: f.category,
      epss,
      // Force KEV when a real feed match exists; else let scoreFinding fall back
      // to its text detection ("actively exploited"/"KEV" in the description).
      knownExploited: kev || undefined,
    }).score;
    return { ...f, kev, epss, risk };
  });
}

/**
 * Recompute + persist full intel for one engagement's findings: base risk (KEV/
 * EPSS/exposure/proof) PLUS attack-chain boosts, so two lows that chain into a
 * real path rise in triage. Idempotent — always recomputes risk from scratch
 * (base + chain boost, capped 100), so re-running never double-counts. Only writes
 * rows whose kev/epss/risk/chain actually changed. Returns the number updated.
 */
export async function recomputeEngagementIntel(engagementId: string): Promise<number> {
  const findings = await prisma.finding.findMany({
    where: { engagementId },
    select: {
      id: true, title: true, description: true, severity: true,
      confirmed: true, status: true, category: true,
      kev: true, epss: true, risk: true, chain: true,
    },
  });
  if (findings.length === 0) return 0;

  const base = await enrichFindingsIntel(findings);
  const chains = correlateChains(
    findings.map((f): ChainFinding => ({
      id: f.id, title: f.title, description: f.description ?? "", severity: f.severity,
    })),
  );
  const chainById = new Map(chains.map((c) => [c.id, c]));

  let updated = 0;
  for (const f of base) {
    const orig = findings.find((x) => x.id === f.id)!;
    const ch = chainById.get(f.id);
    const risk = Math.min(100, f.risk + (ch?.boost ?? 0));
    const chain = ch?.label ?? "";
    if (orig.kev === f.kev && orig.epss === f.epss && orig.risk === risk && orig.chain === chain) continue;
    await prisma.finding
      .update({ where: { id: f.id }, data: { kev: f.kev, epss: f.epss, risk, chain } })
      .catch(() => {});
    updated += 1;
  }
  return updated;
}

export const _test = { cvesIn };
