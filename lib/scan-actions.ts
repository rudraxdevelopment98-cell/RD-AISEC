"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { runScan, runScans, parseTargets } from "@/lib/scanner";
import { ingestFindings } from "@/lib/finding-ingest";
import { ownerScope } from "@/lib/ownership";

/** Bare host from a target for the dedup host key. */
function hostOf(v: string): string {
  return v.replace(/^[a-z]+:\/\//i, "").split("/")[0].split(":")[0].toLowerCase();
}

/** Verify the caller owns the engagement (multi-owner isolation). Returns it or null. */
async function ownedEngagement(engagementId: string, email: string) {
  if (!engagementId) return null;
  return prisma.engagement.findFirst({ where: { id: engagementId, ...ownerScope(email) }, select: { id: true } });
}

/**
 * Re-run the scan server-side (so we trust the data, not the client) and save
 * every FAILED check as a finding — through the same accuracy chain (gate,
 * suppress, dedup, enrich) the runner path uses, so these aren't second-class.
 */
export async function saveScanFindings(formData: FormData) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/login");

  const engagementId = String(formData.get("engagementId") ?? "");
  const target = String(formData.get("target") ?? "").slice(0, 2048);
  if (!engagementId || !target.trim()) return;
  if (!(await ownedEngagement(engagementId, email))) return; // multi-owner isolation

  const result = await runScan(target);
  const failed = result.checks.filter((c) => !c.passed);
  if (failed.length === 0) return;

  const candidates = failed.map((c) => ({
    title: `${c.name} — ${result.target}`,
    severity: c.severity,
    description: `Automated posture scan of ${result.finalUrl ?? result.target}.\n\n${c.detail}`,
    recommendation: c.recommendation,
  }));
  await ingestFindings(engagementId, candidates, { tool: "posture", host: hostOf(result.target) });

  revalidatePath(`/dashboard/engagements/${engagementId}`);
  redirect(`/dashboard/engagements/${engagementId}`);
}

/**
 * Bulk variant: re-run scans for every target server-side and save all failed
 * checks (across all targets) as findings on the chosen engagement.
 */
export async function saveBulkScanFindings(formData: FormData) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/login");

  const engagementId = String(formData.get("engagementId") ?? "");
  const targets = parseTargets(String(formData.get("targets") ?? ""));
  if (!engagementId || targets.length === 0) return;
  if (!(await ownedEngagement(engagementId, email))) return; // multi-owner isolation

  const results = await runScans(targets);
  // Group candidates by host so dedup's host key is right per target.
  for (const r of results) {
    const failed = r.checks.filter((c) => !c.passed);
    if (failed.length === 0) continue;
    const candidates = failed.map((c) => ({
      title: `${c.name} — ${r.target}`,
      severity: c.severity,
      description: `Automated posture scan of ${r.finalUrl ?? r.target}.\n\n${c.detail}`,
      recommendation: c.recommendation,
    }));
    await ingestFindings(engagementId, candidates, { tool: "posture", host: hostOf(r.target), notify: false });
  }

  revalidatePath(`/dashboard/engagements/${engagementId}`);
  redirect(`/dashboard/engagements/${engagementId}`);
}
