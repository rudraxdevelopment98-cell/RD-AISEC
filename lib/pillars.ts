// Service-line (pillar) helpers — plain data module (no "use server"), so the
// discipline pages (pentest / forensics / consulting) can load THEIR engagements
// and turn a static brochure into a real workspace tied to the engagement engine.

import { prisma } from "@/lib/db";

export type PillarEngagement = {
  id: string;
  name: string;
  status: string;
  client: string;
  findings: number;
  open: number;
  updatedAt: Date;
};

/** Engagements of a given type with finding + open-finding counts. */
export async function pillarEngagements(type: string): Promise<PillarEngagement[]> {
  const engs = await prisma.engagement.findMany({
    where: { type },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, status: true, client: true, updatedAt: true, _count: { select: { findings: true } } },
  });
  if (engs.length === 0) return [];
  const open = await prisma.finding.groupBy({
    by: ["engagementId"],
    where: { engagementId: { in: engs.map((e) => e.id) }, status: "open" },
    _count: true,
  });
  const openMap = new Map(open.map((o) => [o.engagementId, o._count]));
  return engs.map((e) => ({
    id: e.id,
    name: e.name,
    status: e.status,
    client: e.client,
    findings: e._count.findings,
    open: openMap.get(e.id) ?? 0,
    updatedAt: e.updatedAt,
  }));
}
