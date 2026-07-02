"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { signatureOf, hostFromTitle, type SuppressionRule } from "@/lib/suppression-core";
import { logAudit } from "@/lib/audit";

async function requireEmail(): Promise<string> {
  const session = await auth();
  return session?.user?.email ?? "";
}

/** All active suppression rules (small table; loaded per import). */
export async function loadRules(): Promise<SuppressionRule[]> {
  const rows = await prisma.suppression.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({
    id: r.id,
    scope: r.scope,
    host: r.host,
    tool: r.tool,
    vulnClass: r.vulnClass,
    titleKey: r.titleKey,
  }));
}

/**
 * Learn a suppression from a finding the operator marked as a false positive.
 * Idempotent per (titleKey + vulnClass + scope). Default scope is global so the
 * same noise is suppressed everywhere; the rule is fully visible + removable.
 */
export async function learnFromFinding(findingId: string, by: string): Promise<void> {
  const f = await prisma.finding.findUnique({
    where: { id: findingId },
    select: { title: true, description: true },
  });
  if (!f) return;
  const sig = signatureOf(f);
  if (!sig.titleKey) return; // nothing stable to key on
  const existing = await prisma.suppression.findFirst({
    where: { titleKey: sig.titleKey, vulnClass: sig.vulnClass, scope: "global" },
  });
  if (existing) return;
  await prisma.suppression.create({
    data: {
      scope: "global",
      host: hostFromTitle(f.title),
      vulnClass: sig.vulnClass,
      titleKey: sig.titleKey,
      reason: `Marked false positive${by ? ` by ${by}` : ""}`,
      createdBy: by,
    },
  });
  await logAudit({
    type: "suppression.learned",
    actor: by,
    summary: `Learned to suppress "${sig.titleKey}" (marked false positive)`,
    severity: "info",
  });
}

/** Record that N findings were auto-suppressed on import: bump hit counters + log. */
export async function recordSuppressions(
  hits: { ruleId?: string }[],
  ctx: { engagementName?: string },
): Promise<void> {
  if (hits.length === 0) return;
  const ids = hits.map((h) => h.ruleId).filter((x): x is string => !!x);
  if (ids.length > 0) {
    await prisma.suppression.updateMany({
      where: { id: { in: ids } },
      data: { hits: { increment: 1 } },
    }).catch(() => {});
  }
  await logAudit({
    type: "suppression.applied",
    summary: `Auto-suppressed ${hits.length} learned false positive(s)${
      ctx.engagementName ? ` on ${ctx.engagementName}` : ""
    }`,
    severity: "info",
  });
}

/** Form action: delete a learned rule (owner-managed, reversible). */
export async function deleteSuppression(formData: FormData): Promise<void> {
  await requireEmail();
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.suppression.delete({ where: { id } }).catch(() => {});
  revalidatePath("/dashboard/findings");
}
