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
import { encryptSecret } from "@/lib/crypto";
import { isSafeHeader, describeHeader } from "@/lib/auth-scan";
import { logAudit } from "@/lib/audit";
import { learnFromFinding } from "@/lib/suppression";
import { ownerScope, viaEngagementScope } from "@/lib/ownership";

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
  const email = await requireUser();
  return prisma.engagement.findMany({
    where: ownerScope(email),
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { findings: true } },
      // Where it belongs: the platform of any linked bug-bounty program.
      bugPrograms: { select: { platform: true } },
    },
  });
}

export async function getEngagement(id: string) {
  const email = await requireUser();
  return prisma.engagement.findFirst({
    where: { id, ...ownerScope(email) },
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
  const email = await requireUser();
  const id = String(formData.get("id") ?? "");
  const status = oneOf(formData.get("status"), ENGAGEMENT_STATUSES, "planning");
  await prisma.engagement.updateMany({ where: { id, ...ownerScope(email) }, data: { status } });
  revalidatePath(`/dashboard/engagements/${id}`);
}

export async function updateEngagementAuthorization(formData: FormData) {
  const email = await requireUser();
  const id = String(formData.get("id") ?? "");
  const authorized = String(formData.get("authorized") ?? "") === "true";
  const authorizedBy = String(formData.get("authorizedBy") ?? "").trim();

  await prisma.engagement.updateMany({
    where: { id, ...ownerScope(email) },
    data: { authorized, authorizedBy: authorized ? authorizedBy || email : "" },
  });
  revalidatePath(`/dashboard/engagements/${id}`);
}

/**
 * Set (or clear) an engagement's authenticated-scan session — a single HTTP
 * header (session cookie or bearer token) injected into header-capable scan
 * tools so they run as the logged-in user. Stored ENCRYPTED at rest; the
 * plaintext leaves the DB only server-side at job-serve time. Owner-only.
 */
export async function setEngagementAuthSession(formData: FormData) {
  const email = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const raw = String(formData.get("authSession") ?? "").trim();
  const back = `/dashboard/engagements/${id}`;

  const eng = await prisma.engagement.findUnique({
    where: { id },
    select: { ownerEmail: true },
  });
  if (!eng) redirect(`${back}?error=${encodeURIComponent("Engagement not found.")}`);
  if (eng!.ownerEmail && eng!.ownerEmail !== email) {
    redirect(`${back}?error=${encodeURIComponent("Only the engagement owner can set a scan session.")}`);
  }

  if (raw && !isSafeHeader(raw)) {
    redirect(
      `${back}?error=${encodeURIComponent(
        "That doesn't look like a header. Use a single line like \"Cookie: session=…\" or \"Authorization: Bearer …\".",
      )}`,
    );
  }

  await prisma.engagement.update({
    where: { id },
    data: { authSession: raw ? encryptSecret(raw) : "" },
  });
  await logAudit({
    type: raw ? "engagement.auth_session.set" : "engagement.auth_session.cleared",
    actor: email,
    summary: raw
      ? `Set authenticated-scan session (${describeHeader(raw)}) on engagement`
      : "Cleared authenticated-scan session on engagement",
    target: id,
  });

  revalidatePath(back);
  redirect(`${back}?ok=${encodeURIComponent(raw ? "Scan session saved (encrypted)." : "Scan session cleared.")}`);
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

  await prisma.engagement.updateMany({
    where: { id, ...ownerScope(email) },
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
  const email = await requireUser();
  const id = String(formData.get("id") ?? "");
  await prisma.engagement.deleteMany({ where: { id, ...ownerScope(email) } });
  revalidatePath("/dashboard/engagements");
  redirect("/dashboard/engagements");
}

/** Bulk delete selected engagements (and their findings, via cascade). */
export async function bulkDeleteEngagements(formData: FormData) {
  const email = await requireUser();
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (ids.length) await prisma.engagement.deleteMany({ where: { id: { in: ids }, ...ownerScope(email) } });
  revalidatePath("/dashboard/engagements");
  redirect(`/dashboard/engagements?ok=${encodeURIComponent(`Deleted ${ids.length} engagement(s)`)}`);
}

/** Bulk set category/tag on selected engagements. */
export async function bulkSetEngagementCategory(formData: FormData) {
  const email = await requireUser();
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  const category = String(formData.get("category") ?? "").trim().slice(0, 60);
  if (ids.length && category) {
    await prisma.engagement.updateMany({ where: { id: { in: ids }, ...ownerScope(email) }, data: { category } });
  }
  revalidatePath("/dashboard/engagements");
  redirect(`/dashboard/engagements?ok=${encodeURIComponent(`Tagged ${ids.length} engagement(s)`)}`);
}

/** Bulk set status on selected engagements. */
export async function bulkSetEngagementStatus(formData: FormData) {
  const email = await requireUser();
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  const status = oneOf(formData.get("status"), ENGAGEMENT_STATUSES, "planning");
  if (ids.length) {
    await prisma.engagement.updateMany({ where: { id: { in: ids }, ...ownerScope(email) }, data: { status } });
  }
  revalidatePath("/dashboard/engagements");
  redirect(`/dashboard/engagements?ok=${encodeURIComponent(`Updated ${ids.length} engagement(s)`)}`);
}

/** Bulk set type on selected engagements. */
export async function bulkSetEngagementType(formData: FormData) {
  const email = await requireUser();
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  const type = oneOf(formData.get("type"), ENGAGEMENT_TYPES, "pentest");
  if (ids.length) {
    await prisma.engagement.updateMany({ where: { id: { in: ids }, ...ownerScope(email) }, data: { type } });
  }
  revalidatePath("/dashboard/engagements");
  redirect(`/dashboard/engagements?ok=${encodeURIComponent(`Updated ${ids.length} engagement(s)`)}`);
}

export async function addFinding(formData: FormData) {
  const email = await requireUser();
  const engagementId = String(formData.get("engagementId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!engagementId || !title) return;
  // Only add findings to an engagement you own.
  const owns = await prisma.engagement.findFirst({
    where: { id: engagementId, ...ownerScope(email) },
    select: { id: true },
  });
  if (!owns) return;

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
  const email = await requireUser();
  const id = String(formData.get("id") ?? "");
  const engagementId = String(formData.get("engagementId") ?? "");
  const status = oneOf(formData.get("status"), FINDING_STATUSES, "open");
  const updated = await prisma.finding.updateMany({
    where: { id, ...viaEngagementScope(email) },
    data: { status },
  });
  // Learn: marking a finding a false positive teaches the engine to suppress
  // that class of finding on future scans.
  if (status === "false_positive" && updated.count > 0) {
    await learnFromFinding(id, email).catch(() => {});
  }
  revalidatePath(`/dashboard/engagements/${engagementId}`);
}

export async function deleteFinding(formData: FormData) {
  const email = await requireUser();
  const id = String(formData.get("id") ?? "");
  const engagementId = String(formData.get("engagementId") ?? "");
  await prisma.finding.deleteMany({ where: { id, ...viaEngagementScope(email) } });
  revalidatePath(`/dashboard/engagements/${engagementId}`);
}
