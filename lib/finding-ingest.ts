// The ONE path raw candidate findings take to become stored findings, so every
// source (runner results, the posture-scan button, recon) gets the SAME accuracy
// chain instead of some writing raw rows:
//
//   tag (ATT&CK/OWASP) → GATE (freshness + proof, drop patched/banner-only FPs)
//   → learned-FP SUPPRESSION → signature DEDUP + cross-tool corroboration
//   → threat-intel ENRICH (KEV/EPSS/risk) → create → (optional) notify
//
// Before this, only the runner result route ran the full chain; the posture and
// recon paths did a raw createMany, so their findings were ungated, un-deduped and
// un-enriched — lower accuracy and duplicate rows. This module is that chain,
// callable from anywhere.

import { prisma } from "@/lib/db";
import { tagFindings } from "@/lib/finding-map";
import { gateFindings, type GateFinding } from "@/lib/finding-gate";
import { loadRules, recordSuppressions } from "@/lib/suppression";
import { filterSuppressed } from "@/lib/suppression-core";
import { dedupFindings } from "@/lib/dedup-core";
import { enrichFindingsIntel } from "@/lib/engine/finding-intel";
import { notifyFindings } from "@/lib/notify";

export type IngestResult = { created: number; merged: number; dropped: number; suppressed: number };

/**
 * Run candidate findings through the full accuracy chain and persist the survivors
 * on `engagementId`. Corroborating candidates merge into existing findings (adding
 * `opts.tool` to their sources) instead of duplicating. Returns per-stage counts.
 */
export async function ingestFindings(
  engagementId: string,
  candidates: GateFinding[],
  opts: { tool: string; host?: string; notify?: boolean },
): Promise<IngestResult> {
  const empty: IngestResult = { created: 0, merged: 0, dropped: 0, suppressed: 0 };
  if (!engagementId || candidates.length === 0) return empty;

  const host = (opts.host ?? "").toLowerCase();

  // 1. Accuracy gate (freshness + proof) — drop patched / banner-only FPs.
  const gated = gateFindings(tagFindings(candidates, opts.tool));

  // 2. Learned false-positive suppression (rules you created by marking FPs).
  const sup = filterSuppressed(gated.kept, await loadRules(), { tool: opts.tool, host });
  if (sup.suppressed.length > 0) await recordSuppressions(sup.suppressed, {});
  if (sup.kept.length === 0) {
    return { ...empty, dropped: gated.dropped, suppressed: sup.suppressed.length };
  }

  // 3. Signature dedup + cross-tool corroboration against existing findings.
  const existing = await prisma.finding.findMany({
    where: { engagementId },
    select: { id: true, title: true, description: true, sources: true },
  });
  const { fresh, merges } = dedupFindings(sup.kept, existing, opts.tool, host);
  for (const m of merges) {
    await prisma.finding.update({ where: { id: m.id }, data: { sources: m.sources } }).catch(() => {});
  }

  // 4. Threat-intel enrich (KEV/EPSS/risk) + create.
  let created = 0;
  if (fresh.length > 0) {
    const enriched = await enrichFindingsIntel(fresh);
    await prisma.finding.createMany({ data: enriched.map((f) => ({ ...f, engagementId })) });
    created = fresh.length;
    await prisma.engagement
      .update({ where: { id: engagementId }, data: { updatedAt: new Date() } })
      .catch(() => {});
    if (opts.notify !== false) {
      const eng = await prisma.engagement.findUnique({ where: { id: engagementId }, select: { name: true } });
      await notifyFindings(fresh, eng?.name ?? "");
    }
  }

  return { created, merged: merges.length, dropped: gated.dropped, suppressed: sup.suppressed.length };
}
