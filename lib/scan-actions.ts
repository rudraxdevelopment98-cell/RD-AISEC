"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { runScan, runScans, parseTargets } from "@/lib/scanner";
import { classifyFinding } from "@/lib/finding-map";

/**
 * Re-run the scan server-side (so we trust the data, not the client) and save
 * every FAILED check as a finding on the chosen engagement.
 */
export async function saveScanFindings(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const engagementId = String(formData.get("engagementId") ?? "");
  const target = String(formData.get("target") ?? "").slice(0, 2048);
  if (!engagementId || !target.trim()) return;

  const result = await runScan(target);
  const failed = result.checks.filter((c) => !c.passed);
  if (failed.length === 0) return;

  await prisma.finding.createMany({
    data: failed.map((c) => {
      const title = `${c.name} — ${result.target}`;
      const description = `Automated posture scan of ${result.finalUrl ?? result.target}.\n\n${c.detail}`;
      return {
        engagementId,
        title,
        severity: c.severity,
        description,
        recommendation: c.recommendation,
        ...classifyFinding({ title, description, severity: c.severity }),
      };
    }),
  });
  await prisma.engagement.update({
    where: { id: engagementId },
    data: { updatedAt: new Date() },
  });

  revalidatePath(`/dashboard/engagements/${engagementId}`);
  redirect(`/dashboard/engagements/${engagementId}`);
}

/**
 * Bulk variant: re-run scans for every target server-side and save all failed
 * checks (across all targets) as findings on the chosen engagement.
 */
export async function saveBulkScanFindings(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const engagementId = String(formData.get("engagementId") ?? "");
  const targets = parseTargets(String(formData.get("targets") ?? ""));
  if (!engagementId || targets.length === 0) return;

  const results = await runScans(targets);
  const data = results.flatMap((r) =>
    r.checks
      .filter((c) => !c.passed)
      .map((c) => {
        const title = `${c.name} — ${r.target}`;
        const description = `Automated posture scan of ${r.finalUrl ?? r.target}.\n\n${c.detail}`;
        return {
          engagementId,
          title,
          severity: c.severity,
          description,
          recommendation: c.recommendation,
          ...classifyFinding({ title, description, severity: c.severity }),
        };
      }),
  );
  if (data.length === 0) return;

  await prisma.finding.createMany({ data });
  await prisma.engagement.update({
    where: { id: engagementId },
    data: { updatedAt: new Date() },
  });

  revalidatePath(`/dashboard/engagements/${engagementId}`);
  redirect(`/dashboard/engagements/${engagementId}`);
}
