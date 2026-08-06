"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { classifyFinding } from "@/lib/finding-map";
import { recomputeEngagementIntel } from "@/lib/engine/finding-intel";

/**
 * One-time (re-runnable) backfill: tag any finding that has no framework tags
 * yet with its MITRE ATT&CK tactic + OWASP category, inferring the source tool
 * from the finding's text. Safe to run repeatedly — only touches findings where
 * both tags are still empty, and only writes when a tag is actually produced.
 */
export async function backfillFrameworkTags() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const untagged = await prisma.finding.findMany({
    where: { attack: "", owasp: "" },
    select: { id: true, title: true, description: true, severity: true },
  });

  let updated = 0;
  for (const f of untagged) {
    const tags = classifyFinding({
      title: f.title,
      description: f.description,
      severity: f.severity,
    });
    if (!tags.attack && !tags.owasp) continue; // nothing to set
    await prisma.finding.update({ where: { id: f.id }, data: tags });
    updated += 1;
  }

  revalidatePath("/dashboard/analytics");
  redirect(`/dashboard/analytics?tagged=${updated}`);
}

/**
 * Re-score every finding with the latest real threat intel (CISA KEV + EPSS) +
 * the engine risk model, stamping kev/epss/risk. Safe to re-run — run it after a
 * fresh KEV/EPSS feed sync, or to backfill findings imported before this existed.
 * Only writes rows whose intel actually changed.
 */
export async function rescoreFindingsIntel(formData?: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Recompute per engagement so attack-chain correlation (which is per-asset
  // within an engagement) is applied alongside the KEV/EPSS/risk refresh.
  const engagements = await prisma.finding.findMany({
    distinct: ["engagementId"],
    select: { engagementId: true },
  });
  let updated = 0;
  for (const e of engagements) {
    updated += await recomputeEngagementIntel(e.engagementId);
  }

  const back = String(formData?.get("back") ?? "/dashboard/findings");
  revalidatePath(back);
  redirect(`${back}?rescored=${updated}`);
}
