"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  ENGAGEMENT_TYPES,
  ENGAGEMENT_STATUSES,
  SEVERITIES,
  FINDING_STATUSES,
} from "@/lib/engagement-constants";

async function requireUser() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  return session.user.email;
}

function oneOf<T extends readonly string[]>(
  value: FormDataEntryValue | null,
  allowed: T,
  fallback: T[number],
): T[number] {
  const v = String(value ?? "");
  return (allowed as readonly string[]).includes(v) ? (v as T[number]) : fallback;
}

export async function listEngagements() {
  await requireUser();
  return prisma.engagement.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { findings: true } } },
  });
}

export async function getEngagement(id: string) {
  await requireUser();
  return prisma.engagement.findUnique({
    where: { id },
    include: { findings: { orderBy: { createdAt: "desc" } } },
  });
}

export async function createEngagement(formData: FormData) {
  const email = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const engagement = await prisma.engagement.create({
    data: {
      name,
      client: String(formData.get("client") ?? "").trim(),
      type: oneOf(formData.get("type"), ENGAGEMENT_TYPES, "pentest"),
      scope: String(formData.get("scope") ?? "").trim(),
      authorized: formData.get("authorized") === "on",
      authorizedBy: String(formData.get("authorizedBy") ?? "").trim(),
      ownerEmail: email,
    },
  });

  revalidatePath("/dashboard/engagements");
  redirect(`/dashboard/engagements/${engagement.id}`);
}

export async function updateEngagementStatus(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  const status = oneOf(formData.get("status"), ENGAGEMENT_STATUSES, "planning");
  await prisma.engagement.update({ where: { id }, data: { status } });
  revalidatePath(`/dashboard/engagements/${id}`);
}

export async function deleteEngagement(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  await prisma.engagement.delete({ where: { id } });
  revalidatePath("/dashboard/engagements");
  redirect("/dashboard/engagements");
}

export async function addFinding(formData: FormData) {
  await requireUser();
  const engagementId = String(formData.get("engagementId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!engagementId || !title) return;

  await prisma.finding.create({
    data: {
      engagementId,
      title,
      severity: oneOf(formData.get("severity"), SEVERITIES, "medium"),
      description: String(formData.get("description") ?? "").trim(),
      recommendation: String(formData.get("recommendation") ?? "").trim(),
    },
  });
  // Touch the engagement so its updatedAt reflects new activity.
  await prisma.engagement.update({
    where: { id: engagementId },
    data: { updatedAt: new Date() },
  });
  revalidatePath(`/dashboard/engagements/${engagementId}`);
}

export async function updateFindingStatus(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  const engagementId = String(formData.get("engagementId") ?? "");
  const status = oneOf(formData.get("status"), FINDING_STATUSES, "open");
  await prisma.finding.update({ where: { id }, data: { status } });
  revalidatePath(`/dashboard/engagements/${engagementId}`);
}

export async function deleteFinding(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  const engagementId = String(formData.get("engagementId") ?? "");
  await prisma.finding.delete({ where: { id } });
  revalidatePath(`/dashboard/engagements/${engagementId}`);
}
