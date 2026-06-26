"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { classifyFinding } from "@/lib/finding-map";

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
