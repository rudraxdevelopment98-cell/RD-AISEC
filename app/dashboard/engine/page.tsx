import { prisma } from "@/lib/db";
import { getKevSet, getEpssMap } from "@/lib/threat-intel";
import { buildEngineIntel, type EngineFinding } from "@/lib/engine/engine-core";
import { EngineConsole, type WirePayload } from "@/components/engine/engine-console";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

/**
 * Engine — Command Center. A modern, redesigned view over the assessment engine's
 * intelligence layer: every finding risk-scored (0–100) and priority-tiered
 * (P1–P4) with an explainable breakdown, detection enrichment (class/CWE/OWASP/
 * ATT&CK/CVE), a concrete remediation plan, candidate attack chains, and asset /
 * attack-surface rollups. Wired to real findings + the CISA KEV catalog.
 */
export default async function EnginePage() {
  const [findings, kev, epss] = await Promise.all([
    prisma.finding.findMany({
      orderBy: { createdAt: "desc" },
      take: 400,
      include: { engagement: { select: { id: true, name: true } } },
    }),
    getKevSet().catch(() => new Set<string>()),
    getEpssMap().catch(() => new Map<string, number>()),
  ]);

  const input: EngineFinding[] = findings.map((f) => ({
    id: f.id,
    title: f.title,
    description: f.description,
    recommendation: f.recommendation,
    severity: f.severity,
    confirmed: f.confirmed,
    reviewed: f.reviewed,
    status: f.status,
    category: f.category,
    attack: f.attack,
    owasp: f.owasp,
    engagementId: f.engagementId,
    engagementName: f.engagement?.name ?? "",
    createdAt: f.createdAt,
  }));

  const intel = buildEngineIntel(input, kev, epss);

  // Serialize to a plain payload (no functions/Dates) for the client console.
  const payload: WirePayload = {
    summary: intel.summary,
    surfaces: intel.surfaces,
    assets: intel.assets.slice(0, 24),
    chains: intel.chains.slice(0, 12),
    items: intel.items.slice(0, 250).map((it) => ({
      id: it.id,
      title: it.title,
      description: (it.description ?? "").slice(0, 1200),
      severity: it.severity,
      status: it.status ?? "open",
      confirmed: !!it.confirmed,
      engagementId: it.engagementId ?? null,
      engagementName: it.engagementName ?? "",
      asset: it.asset,
      risk: it.risk,
      enrich: it.enrich,
    })),
  };

  return (
    <>
      <AutoRefresh seconds={30} />
      <EngineConsole payload={payload} kevCount={kev.size} />
    </>
  );
}
