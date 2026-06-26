"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { parseScopeTargets, platformLabel } from "@/lib/bugbounty-core";
import { isSafeUrl, normalizeTarget, validateTarget } from "@/lib/runner-constants";

const BACK = "/dashboard/bugbounty";

async function requireUser() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/login");
  return email;
}

export async function saveBugAccount(formData: FormData) {
  const email = await requireUser();
  const platform = String(formData.get("platform") ?? "other");
  const handle = String(formData.get("handle") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  if (!handle && !url) {
    redirect(`${BACK}?error=${encodeURIComponent("Enter a handle or a profile link.")}`);
  }
  await prisma.bugAccount.create({ data: { platform, handle, url, ownerEmail: email } });
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${encodeURIComponent("Account saved")}`);
}

export async function deleteBugAccount(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  await prisma.bugAccount.delete({ where: { id } });
  revalidatePath(BACK);
}

export async function addBugProgram(formData: FormData) {
  const email = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect(`${BACK}?error=${encodeURIComponent("Program needs a name.")}`);
  await prisma.bugProgram.create({
    data: {
      name,
      platform: String(formData.get("platform") ?? "hackerone"),
      url: String(formData.get("url") ?? "").trim(),
      scope: String(formData.get("scope") ?? "").trim(),
      outScope: String(formData.get("outScope") ?? "").trim(),
      reward: String(formData.get("reward") ?? "").trim(),
      notes: String(formData.get("notes") ?? "").trim(),
      ownerEmail: email,
    },
  });
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${encodeURIComponent(`${name} added`)}`);
}

export async function updateBugProgram(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  await prisma.bugProgram.update({
    where: { id },
    data: {
      scope: String(formData.get("scope") ?? "").trim(),
      outScope: String(formData.get("outScope") ?? "").trim(),
      url: String(formData.get("url") ?? "").trim(),
      status: String(formData.get("status") ?? "active"),
    },
  });
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${encodeURIComponent("Program updated")}`);
}

export async function deleteBugProgram(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  await prisma.bugProgram.delete({ where: { id } });
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${encodeURIComponent("Program removed")}`);
}

/** Create an authorized engagement from a program's scope and link them. */
export async function createEngagementFromProgram(formData: FormData) {
  const email = await requireUser();
  const id = String(formData.get("id") ?? "");
  const program = await prisma.bugProgram.findUnique({ where: { id } });
  if (!program) redirect(`${BACK}?error=${encodeURIComponent("Program not found.")}`);

  const eng = await prisma.engagement.create({
    data: {
      name: program!.name,
      client: platformLabel(program!.platform),
      type: "pentest",
      status: "active",
      scope: program!.scope,
      authorized: true,
      authorizedBy: `Bug bounty (${platformLabel(program!.platform)})`,
      ownerEmail: email,
    },
  });
  await prisma.bugProgram.update({ where: { id }, data: { engagementId: eng.id } });
  revalidatePath(BACK);
  redirect(`/dashboard/engagements/${eng.id}`);
}

/**
 * Automate recon: queue an httpx probe for each in-scope target on a runner,
 * filed under the program's engagement. Creates the engagement first if needed.
 */
export async function queueProgramRecon(formData: FormData) {
  const email = await requireUser();
  const id = String(formData.get("id") ?? "");
  const runnerId = String(formData.get("runnerId") ?? "");
  if (!runnerId) redirect(`${BACK}?error=${encodeURIComponent("Pick a machine to scan from.")}`);

  const program = await prisma.bugProgram.findUnique({ where: { id } });
  if (!program) redirect(`${BACK}?error=${encodeURIComponent("Program not found.")}`);

  let engagementId = program!.engagementId;
  if (!engagementId) {
    const eng = await prisma.engagement.create({
      data: {
        name: program!.name,
        client: platformLabel(program!.platform),
        type: "pentest",
        status: "active",
        scope: program!.scope,
        authorized: true,
        authorizedBy: `Bug bounty (${platformLabel(program!.platform)})`,
        ownerEmail: email,
      },
    });
    engagementId = eng.id;
    await prisma.bugProgram.update({ where: { id }, data: { engagementId } });
  }

  const targets = parseScopeTargets(program!.scope).slice(0, 25);
  const jobs = targets
    .map((t) => normalizeTarget("httpx", t))
    .filter((t) => validateTarget("httpx", t) && isSafeUrl(t))
    .map((t) => ({
      engagementId: engagementId!,
      runnerId,
      tool: "httpx",
      target: t,
      args: "-title -status-code -tech-detect",
      queuedBy: email,
    }));

  if (jobs.length === 0) {
    redirect(`${BACK}?error=${encodeURIComponent("No scannable in-scope targets found.")}`);
  }
  await prisma.job.createMany({ data: jobs });
  revalidatePath("/dashboard/jobs");
  redirect(`/dashboard/jobs?queued=${jobs.length}`);
}
