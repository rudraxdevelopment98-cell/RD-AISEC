"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { SUBMISSION_STATUSES, parseRewardCents } from "@/lib/submission-core";
import { ownerScope } from "@/lib/ownership";

const BACK = "/dashboard/bugbounty";

async function requireUser() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/login");
  return email;
}

export async function createSubmission(formData: FormData) {
  const email = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) redirect(`${BACK}?error=${encodeURIComponent("A submission needs a title.")}`);
  const status = String(formData.get("status") ?? "submitted");
  await prisma.submission.create({
    data: {
      title: title.slice(0, 300),
      platform: String(formData.get("platform") ?? "hackerone"),
      severity: String(formData.get("severity") ?? "medium"),
      status: (SUBMISSION_STATUSES as readonly string[]).includes(status) ? status : "submitted",
      rewardCents: parseRewardCents(String(formData.get("reward") ?? "")),
      reportUrl: String(formData.get("reportUrl") ?? "").trim().slice(0, 512),
      notes: String(formData.get("notes") ?? "").trim().slice(0, 2000),
      findingId: String(formData.get("findingId") ?? "").trim(),
      engagementId: String(formData.get("engagementId") ?? "").trim() || null,
      ownerEmail: email,
    },
  });
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${encodeURIComponent(`Logged submission: ${title}`)}`);
}

export async function updateSubmission(formData: FormData) {
  const email = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) redirect(BACK);
  const status = String(formData.get("status") ?? "");
  await prisma.submission.updateMany({
    where: { id, ...ownerScope(email) },
    data: {
      ...(status && (SUBMISSION_STATUSES as readonly string[]).includes(status) ? { status } : {}),
      rewardCents: parseRewardCents(String(formData.get("reward") ?? "")),
      ...(formData.has("reportUrl") ? { reportUrl: String(formData.get("reportUrl") ?? "").trim().slice(0, 512) } : {}),
    },
  });
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${encodeURIComponent("Submission updated")}`);
}

export async function deleteSubmission(formData: FormData) {
  const email = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.submission.deleteMany({ where: { id, ...ownerScope(email) } }).catch(() => {});
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${encodeURIComponent("Submission removed")}`);
}
