"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { pickRunnerId } from "@/lib/pipeline-engine";
import { JOB_PRIORITY, normalizeTarget, validateTarget } from "@/lib/runner-constants";
import { isValidRepo, buildSourceReconCommand } from "@/lib/source-recon-core";
import { parseScopeEntries } from "@/lib/bugbounty-core";
import { prioritizeHosts } from "@/lib/engine/target-priority";
import { checkForClass, hypothesisClassOf } from "@/lib/hypothesis-validate";

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

/**
 * One-click "Validate this hypothesis": a white-box source finding has no target
 * of its own, so this queues the matching DYNAMIC check (sqlmap / dalfox / a
 * class-tagged nuclei pass / sslscan) against the engagement's in-scope host to
 * try to PROVE the hypothesis on the live target. Authorized targets only; the
 * check is non-destructive (validation tier). A hit auto-imports and can promote
 * the hypothesis from "detected" toward "validated".
 */
export async function validateHypothesis(formData: FormData) {
  const email = await requireUser();
  const findingId = String(formData.get("findingId") ?? "");
  const finding = await prisma.finding.findUnique({ where: { id: findingId } });
  if (!finding) redirect("/dashboard/findings");
  const engagementId = finding!.engagementId;
  const to = (q: string) => redirect(`${back(engagementId)}?${q}`);

  const eng = await prisma.engagement.findUnique({
    where: { id: engagementId },
    select: { authorized: true, scope: true },
  });
  if (!eng?.authorized) {
    to(`error=${encodeURIComponent("Record written authorization on the engagement before validating on a live target.")}`);
  }

  const cls = hypothesisClassOf(finding!);
  const check = checkForClass(cls);
  if (!check) {
    to(`error=${encodeURIComponent("No automated check for this hypothesis — validate it manually using the guidance on the finding.")}`);
  }

  // The hypothesis has no target; pick the most promising in-scope host.
  const hosts = prioritizeHosts(parseScopeEntries(eng!.scope ?? "").map((e) => e.host));
  const host = hosts[0] ?? "";
  if (!host) {
    to(`error=${encodeURIComponent("Add an in-scope host to this engagement first — the check needs a live target.")}`);
  }
  const rawTarget = check!.mode === "url" ? `http://${host}` : host;
  const target = normalizeTarget(check!.tool, rawTarget);
  if (check!.tool !== "custom" && !validateTarget(check!.tool, target)) {
    to(`error=${encodeURIComponent("Couldn't build a valid target from the engagement scope.")}`);
  }

  const runnerId = await pickRunnerId();
  if (!runnerId) {
    to(`error=${encodeURIComponent("No runner online — connect a machine first.")}`);
  }

  const args = check!.args(target);
  // Dedupe against jobs already queued/running for this engagement.
  const dup = await prisma.job.findFirst({
    where: { engagementId, tool: check!.tool, target, args, status: { in: ["queued", "running"] } },
    select: { id: true },
  });
  if (!dup) {
    await prisma.job.create({
      data: {
        engagementId,
        runnerId: runnerId!,
        tool: check!.tool,
        target,
        args,
        autoImport: true,
        queuedBy: email,
        priority: JOB_PRIORITY.manual,
      },
    });
  }
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  await prisma.finding
    .update({
      where: { id: findingId },
      data: {
        description:
          (finding!.description || "") +
          `\n\n[Validation queued by ${email} on ${stamp}: ${check!.tool} vs ${host} — ${check!.proves}]`,
      },
    })
    .catch(() => {});
  redirect(`/dashboard/jobs?ok=${encodeURIComponent(`Queued ${check!.tool} to validate the ${cls} hypothesis against ${host}`)}`);
}
