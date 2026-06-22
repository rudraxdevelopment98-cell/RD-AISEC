"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { RESOURCE_TYPES } from "@/lib/resource-constants";

async function requireUser() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user.email;
}

export async function createResource(formData: FormData) {
  const email = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  const typeRaw = String(formData.get("type") ?? "link");
  const type = (RESOURCE_TYPES as readonly string[]).includes(typeRaw) ? typeRaw : "link";
  const engagementId = String(formData.get("engagementId") ?? "").trim() || null;

  await prisma.resource.create({
    data: {
      title,
      type,
      url: String(formData.get("url") ?? "").trim(),
      location: String(formData.get("location") ?? "").trim(),
      tags: String(formData.get("tags") ?? "").trim(),
      notes: String(formData.get("notes") ?? "").trim(),
      ownerEmail: email,
      engagementId,
    },
  });

  revalidatePath("/dashboard/library");
  if (engagementId) revalidatePath(`/dashboard/engagements/${engagementId}`);
}

export async function deleteResource(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  const engagementId = String(formData.get("engagementId") ?? "").trim();
  if (!id) return;
  await prisma.resource.delete({ where: { id } });
  revalidatePath("/dashboard/library");
  if (engagementId) revalidatePath(`/dashboard/engagements/${engagementId}`);
}
