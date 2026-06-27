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
import { classifyFinding } from "@/lib/finding-map";

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
    include: {
      _count: { select: { findings: true } },
      // Where it belongs: the platform of any linked bug-bounty program.
      bugPrograms: { select: { platform: true } },
    },
  });
}

export async function getEngagement(id: string) {
  await requireUser();
  return prisma.engagement.findUnique({
    where: { id },
    include: {
      findings: { orderBy: { createdAt: "desc" } },
      resources: { orderBy: { createdAt: "desc" } },
      scans: { orderBy: { createdAt: "desc" } },
    },
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
      category: String(formData.get("category") ?? "").trim().slice(0, 60),
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

export async function updateEngagementAuthorization(formData: FormData) {
  const email = await requireUser();
  const id = String(formData.get("id") ?? "");
  const authorized = String(formData.get("authorized") ?? "") === "true";
  const authorizedBy = String(formData.get("authorizedBy") ?? "").trim();

  await prisma.engagement.update({
    where: { id },
    data: { authorized, authorizedBy: authorized ? authorizedBy || email : "" },
  });
  revalidatePath(`/dashboard/engagements/${id}`);
}

export async function updateEngagement(formData: FormData) {
  const email = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    redirect(`/dashboard/engagements/${id}/edit?error=${encodeURIComponent("Name is required.")}`);
  }
  const authorized = formData.get("authorized") === "on";
  const authorizedBy = String(formData.get("authorizedBy") ?? "").trim();

  await prisma.engagement.update({
    where: { id },
    data: {
      name,
      client: String(formData.get("client") ?? "").trim(),
      type: oneOf(formData.get("type"), ENGAGEMENT_TYPES, "pentest"),
      status: oneOf(formData.get("status"), ENGAGEMENT_STATUSES, "planning"),
      category: String(formData.get("category") ?? "").trim().slice(0, 60),
      scope: String(formData.get("scope") ?? "").trim(),
      authorized,
      authorizedBy: authorized ? authorizedBy || email : "",
    },
  });

  revalidatePath(`/dashboard/engagements/${id}`);
  revalidatePath("/dashboard/engagements");
  redirect(`/dashboard/engagements/${id}`);
}

export async function deleteEngagement(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  await prisma.engagement.delete({ where: { id } });
  revalidatePath("/dashboard/engagements");
  redirect("/dashboard/engagements");
}

/** Bulk delete selected engagements (and their findings, via cascade). */
export async function bulkDeleteEngagements(formData: FormData) {
  await requireUser();
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (ids.length) await prisma.engagement.deleteMany({ where: { id: { in: ids } } });
  revalidatePath("/dashboard/engagements");
  redirect(`/dashboard/engagements?ok=${encodeURIComponent(`Deleted ${ids.length} engagement(s)`)}`);
}

/** Bulk set category/tag on selected engagements. */
export async function bulkSetEngagementCategory(formData: FormData) {
  await requireUser();
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  const category = String(formData.get("category") ?? "").trim().slice(0, 60);
  if (ids.length) {
    await prisma.engagement.updateMany({ where: { id: { in: ids } }, data: { category } });
  }
  revalidatePath("/dashboard/engagements");
  redirect(`/dashboard/engagements?ok=${encodeURIComponent(`Tagged ${ids.length} engagement(s)`)}`);
}

/** Bulk set status on selected engagements. */
export async function bulkSetEngagementStatus(formData: FormData) {
  await requireUser();
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  const status = oneOf(formData.get("status"), ENGAGEMENT_STATUSES, "planning");
  if (ids.length) {
    await prisma.engagement.updateMany({ where: { id: { in: ids } }, data: { status } });
  }
  revalidatePath("/dashboard/engagements");
  redirect(`/dashboard/engagements?ok=${encodeURIComponent(`Updated ${ids.length} engagement(s)`)}`);
}

/** Bulk set type on selected engagements. */
export async function bulkSetEngagementType(formData: FormData) {
  await requireUser();
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  const type = oneOf(formData.get("type"), ENGAGEMENT_TYPES, "pentest");
  if (ids.length) {
    await prisma.engagement.updateMany({ where: { id: { in: ids } }, data: { type } });
  }
  revalidatePath("/dashboard/engagements");
  redirect(`/dashboard/engagements?ok=${encodeURIComponent(`Updated ${ids.length} engagement(s)`)}`);
}

export async function addFinding(formData: FormData) {
  await requireUser();
  const engagementId = String(formData.get("engagementId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!engagementId || !title) return;

  const severity = oneOf(formData.get("severity"), SEVERITIES, "medium");
  const description = String(formData.get("description") ?? "").trim();
  await prisma.finding.create({
    data: {
      engagementId,
      title,
      severity,
      description,
      recommendation: String(formData.get("recommendation") ?? "").trim(),
      ...classifyFinding({ title, description, severity }),
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
