"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { findingTarget } from "@/data/exploit-playbook";
import { validatableClass, validationJobFor, VALIDATE_PREFIX } from "@/lib/engine/validators";
import { pickRunnerId } from "@/lib/pipeline-engine";
import { JOB_PRIORITY } from "@/lib/runner-constants";
import { logAudit } from "@/lib/audit";

async function requireUser(): Promise<string> {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  return session.user.email;
}

/**
 * Launch an automated exploit validation ("prove it") for a finding. Owner-gated
 * and authorized-only. Queues the per-class proof job (headless XSS / OAST SSRF /
 * sqlmap differential); the result route parses the proof and, only if PROVEN,
 * sets finding.confirmed + finding.proof. Unproven findings stay unreportable.
 */
export async function launchValidation(formData: FormData) {
  const email = await requireUser();
  const id = String(formData.get("id") ?? "");
  const back = `/dashboard/findings/${id}/exploit`;
  if (!id) redirect("/dashboard/findings");

  const finding = await prisma.finding.findUnique({
    where: { id },
    include: { engagement: { select: { id: true, ownerEmail: true, authorized: true } } },
  });
  if (!finding) redirect(`${back}?error=${encodeURIComponent("Finding not found.")}`);
  const eng = finding!.engagement;
  if (eng.ownerEmail && eng.ownerEmail !== email) {
    redirect(`${back}?error=${encodeURIComponent("Only the engagement owner can run validation.")}`);
  }
  if (!eng.authorized) {
    redirect(`${back}?error=${encodeURIComponent("Record written authorization on the engagement before validating against the target.")}`);
  }

  const cls = validatableClass(finding!);
  if (!cls) {
    redirect(`${back}?error=${encodeURIComponent("No automated validator exists for this finding's class yet — verify it manually.")}`);
  }
  const { host, url } = findingTarget(finding!);
  const target = url || host;
  if (!target) {
    redirect(`${back}?error=${encodeURIComponent("Couldn't derive a target URL/host to validate from this finding.")}`);
  }
  const job = validationJobFor(cls!, target);
  if (!job) {
    redirect(`${back}?error=${encodeURIComponent("No validator job for this class.")}`);
  }

  const runnerId = await pickRunnerId();
  if (!runnerId) {
    redirect(`${back}?error=${encodeURIComponent("No runner online — connect a machine first.")}`);
  }

  await prisma.job.create({
    data: {
      engagementId: eng.id,
      runnerId: runnerId!,
      tool: job!.tool,
      target: target!,
      args: job!.args,
      autoImport: false, // proof job — parsed by the validation branch, not imported as a new finding
      queuedBy: `${VALIDATE_PREFIX}${id}`,
      priority: JOB_PRIORITY.manual,
    },
  });
  await logAudit({
    type: "finding.validate",
    actor: email,
    summary: `Launched ${cls} proof (${job!.method}) via ${job!.tool} on ${target}`,
    target: id,
  });
  redirect(`${back}?ok=${encodeURIComponent(`Validation queued — proving ${cls} with ${job!.tool} (${job!.method}). Result updates this finding when done.`)}`);
}
