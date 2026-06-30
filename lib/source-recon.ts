"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { pickRunnerId } from "@/lib/pipeline-engine";
import { JOB_PRIORITY } from "@/lib/runner-constants";
import { isValidRepo, buildSourceReconCommand } from "@/lib/source-recon-core";

async function requireUser() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  return session.user.email;
}

const back = (id: string) => `/dashboard/engagements/${id}`;

/** Save (or clear) the white-box source-repo URL on an engagement. */
export async function setSourceRepo(formData: FormData) {
  await requireUser();
  const engagementId = String(formData.get("engagementId") ?? "");
  const repo = String(formData.get("repo") ?? "").trim();
  if (!engagementId) redirect("/dashboard/engagements");
  if (repo && !isValidRepo(repo)) {
    redirect(`${back(engagementId)}?error=${encodeURIComponent("Use a plain https:// git URL (e.g. https://github.com/owner/repo) — no credentials or special characters.")}`);
  }
  await prisma.engagement.update({ where: { id: engagementId }, data: { sourceRepo: repo } });
  revalidatePath(back(engagementId));
  redirect(`${back(engagementId)}?ok=${encodeURIComponent(repo ? "Source repo saved" : "Source repo cleared")}`);
}

/**
 * Queue a white-box source-recon job: the runner clones the repo and ships back
 * its source, which the portal analyzes into framework/endpoint/vulnerability
 * HYPOTHESES (state "detected" until validated). Authorized targets only.
 */
export async function queueSourceRecon(formData: FormData) {
  const email = await requireUser();
  const engagementId = String(formData.get("engagementId") ?? "");
  if (!engagementId) redirect("/dashboard/engagements");
  let repo = String(formData.get("repo") ?? "").trim();
  if (!repo) {
    const e = await prisma.engagement.findUnique({ where: { id: engagementId }, select: { sourceRepo: true } });
    repo = e?.sourceRepo ?? "";
  }
  if (!isValidRepo(repo)) {
    redirect(`${back(engagementId)}?error=${encodeURIComponent("Set a valid https:// git repo URL first.")}`);
  }
  const runnerId = String(formData.get("runnerId") ?? "") || (await pickRunnerId());
  if (!runnerId) {
    redirect(`${back(engagementId)}?error=${encodeURIComponent("No runner available — connect a machine first.")}`);
  }
  // Remember the repo for next time (best-effort).
  await prisma.engagement.update({ where: { id: engagementId }, data: { sourceRepo: repo } }).catch(() => {});
  await prisma.job.create({
    data: {
      engagementId,
      runnerId,
      tool: "custom",
      target: `sourcerecon:${repo}`,
      args: buildSourceReconCommand(repo),
      autoImport: true,
      queuedBy: email,
      priority: JOB_PRIORITY.exploit,
    },
  });
  redirect("/dashboard/jobs?queued=1");
}
