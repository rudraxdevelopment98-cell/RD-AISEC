"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { classifyFinding } from "@/lib/finding-map";
import { enrichFindingsIntel } from "@/lib/engine/finding-intel";

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

  const findings = await prisma.finding.findMany({
    select: {
      id: true, title: true, description: true, severity: true,
      confirmed: true, status: true, category: true,
      kev: true, epss: true, risk: true,
    },
  });
  const enriched = await enrichFindingsIntel(findings);
  let updated = 0;
  for (const f of enriched) {
    const orig = findings.find((x) => x.id === f.id)!;
    if (orig.kev === f.kev && orig.epss === f.epss && orig.risk === f.risk) continue;
    await prisma.finding
      .update({ where: { id: f.id }, data: { kev: f.kev, epss: f.epss, risk: f.risk } })
      .catch(() => {});
    updated += 1;
  }

  const back = String(formData?.get("back") ?? "/dashboard/findings");
  revalidatePath(back);
  redirect(`${back}?rescored=${updated}`);
}
