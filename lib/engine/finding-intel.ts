import "server-only";

import { getKevSet, getEpssMap } from "@/lib/threat-intel";
import { scoreFinding } from "@/lib/engine/risk-core";

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

export const _test = { cvesIn };
