// Engine intelligence aggregator — the single entry point the Engine UI calls.
// Takes raw findings (+ the KEV set and optional EPSS map) and returns everything
// the command center renders: risk-scored + remediation-planned items, tier
// counts, a portfolio risk index, per-asset rollups, attack-surface distribution,
// and candidate attack chains. Pure (no DB/IO), client-safe, unit-tested.

import { classifyFindingVuln, type Surface } from "@/lib/vuln-taxonomy";
import { extractAsset, type FindingLike } from "@/lib/assessment";
import { prioritize, riskSummary, firstCve, type RiskInput, type Scored, type Tier } from "@/lib/engine/risk-core";
import { remediationPlan, type RemediationPlan } from "@/lib/engine/remediation-core";

export type EngineFinding = RiskInput &
  FindingLike & {
    id: string;
    engagementId?: string | null;
    engagementName?: string | null;
  };

export type Enrichment = {
  classId: string | null;
  classLabel: string;
  owasp: string | null;
  cwe: string | null;
  attack: string | null;
  surface: Surface | "info";
  cvssBand: string | null;
  indicators: string[];
  cve: string | null;
};

export type EngineItem = Scored<EngineFinding> & {
  enrich: Enrichment;
  asset: string;
};

export type AssetRollup = { asset: string; count: number; topScore: number; tier: Tier; kev: number };
export type SurfaceSlice = { surface: string; count: number };
export type AttackChain = {
  asset: string;
  steps: { label: string; classId: string | null; tier: Tier; score: number }[];
  combinedRisk: number;
  rationale: string;
};

export type EngineIntel = {
  items: EngineItem[];
  summary: ReturnType<typeof riskSummary>;
  assets: AssetRollup[];
  surfaces: SurfaceSlice[];
  chains: AttackChain[];
  planFor: (id: string) => RemediationPlan | null;
};

/** Detection enrichment: classify the finding and surface its framework refs. */
export function enrich(f: EngineFinding, kev?: Set<string>): Enrichment {
  const cls = classifyFindingVuln({ title: f.title, description: f.description });
  const cve = firstCve(`${f.title} ${f.description ?? ""}`);
  return {
    classId: cls?.id ?? null,
    classLabel: cls?.label ?? "Unclassified",
    owasp: cls?.owasp ?? (f.owasp || null),
    cwe: cls?.cwe ?? null,
    attack: cls?.attack ?? (f.attack || null),
    surface: cls?.surface ?? "info",
    cvssBand: cls?.cvss ?? null,
    indicators: cls?.indicators ?? [],
    cve,
  };
}

// Classes that typically GAIN access vs those that represent IMPACT/escalation —
// used to recognize a plausible multi-step chain on one asset.
const ACCESS = new Set(["rce", "sqli", "ssti", "deserialization", "file_upload", "lfi", "auth_bypass", "default_creds", "legacy_smb", "xxe"]);
const IMPACT = new Set(["idor", "ato", "ssrf", "secrets", "info_disclosure", "subdomain_takeover", "stored_xss"]);

/** Build the whole engine view in one pass. */
export function buildEngineIntel(findings: EngineFinding[], kev?: Set<string>, epssMap?: Map<string, number>): EngineIntel {
  // Stamp knownExploited from the KEV set before scoring.
  const withKev = findings.map((f) => {
    const cve = firstCve(`${f.title} ${f.description ?? ""}`);
    const knownExploited = f.knownExploited ?? (!!cve && !!kev && kev.has(cve.toUpperCase()));
    return { ...f, knownExploited };
  });

  const scored = prioritize(withKev, epssMap);
  const items: EngineItem[] = scored.map((s) => ({
    ...s,
    enrich: enrich(s, kev),
    asset: extractAsset(s),
  }));

  const summary = riskSummary(scored);
  const assets = assetRollup(items);
  const surfaces = surfaceDistribution(items);
  const chains = attackChains(items);
  const planCache = new Map<string, RemediationPlan>();

  return {
    items,
    summary,
    assets,
    surfaces,
    chains,
    planFor: (id: string) => {
      const it = items.find((i) => i.id === id);
      if (!it) return null;
      if (!planCache.has(id)) planCache.set(id, remediationPlan(it));
      return planCache.get(id)!;
    },
  };
}

export function assetRollup(items: EngineItem[]): AssetRollup[] {
  const by = new Map<string, EngineItem[]>();
  for (const it of items) {
    const a = it.asset || "unspecified";
    (by.get(a) ?? by.set(a, []).get(a)!).push(it);
  }
  const rows: AssetRollup[] = [];
  for (const [asset, list] of by) {
    const top = list.reduce((m, i) => (i.risk.score > m.risk.score ? i : m), list[0]);
    rows.push({
      asset,
      count: list.length,
      topScore: top.risk.score,
      tier: top.risk.tier,
      kev: list.filter((i) => i.risk.knownExploited).length,
    });
  }
  return rows.sort((a, b) => b.topScore - a.topScore || b.count - a.count);
}

export function surfaceDistribution(items: EngineItem[]): SurfaceSlice[] {
  const by = new Map<string, number>();
  for (const it of items) by.set(it.enrich.surface, (by.get(it.enrich.surface) ?? 0) + 1);
  return Array.from(by, ([surface, count]) => ({ surface, count })).sort((a, b) => b.count - a.count);
}

/**
 * Candidate attack chains: an asset where findings plausibly combine into a
 * multi-step path (an access-gaining weakness + an impact/escalation one, or
 * three-plus stacked issues). Honest heuristic — flags where to look, not a
 * proven exploit path.
 */
export function attackChains(items: EngineItem[]): AttackChain[] {
  const by = new Map<string, EngineItem[]>();
  for (const it of items) {
    if (!it.asset) continue;
    (by.get(it.asset) ?? by.set(it.asset, []).get(it.asset)!).push(it);
  }
  const chains: AttackChain[] = [];
  for (const [asset, listRaw] of by) {
    const list = [...listRaw].sort((a, b) => b.risk.score - a.risk.score);
    const hasAccess = list.some((i) => i.enrich.classId && ACCESS.has(i.enrich.classId));
    const hasImpact = list.some((i) => i.enrich.classId && IMPACT.has(i.enrich.classId));
    if (!((hasAccess && hasImpact) || list.length >= 3)) continue;

    const steps = list.slice(0, 4).map((i) => ({
      label: i.enrich.classLabel,
      classId: i.enrich.classId,
      tier: i.risk.tier,
      score: i.risk.score,
    }));
    const top = list[0].risk.score;
    const combinedRisk = Math.min(100, Math.round(top + Math.min(15, (list.length - 1) * 5)));
    chains.push({
      asset,
      steps,
      combinedRisk,
      rationale:
        hasAccess && hasImpact
          ? "An access-gaining weakness co-occurs with an impact/escalation one on this asset — chainable to deeper compromise."
          : `${list.length} findings stack on this asset — combined exposure exceeds any single issue.`,
    });
  }
  return chains.sort((a, b) => b.combinedRisk - a.combinedRisk);
}
