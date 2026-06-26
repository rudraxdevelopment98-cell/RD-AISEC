"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { MAX_BULK_TARGETS } from "@/lib/scanner";
import { SCAN_FREQUENCIES, splitTargets, runSchedule } from "@/lib/scheduled-core";

async function requireUser() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  return session.user.email;
}

export async function createSchedule(formData: FormData) {
  const email = await requireUser();
  const engagementId = String(formData.get("engagementId") ?? "");
  const raw = String(formData.get("targets") ?? "");
  const frequency = String(formData.get("frequency") ?? "daily");

  const targets = splitTargets(raw).slice(0, MAX_BULK_TARGETS);
  if (!engagementId || targets.length === 0) {
    redirect("/dashboard/scan?error=Pick+an+engagement+and+at+least+one+target");
  }
  const freq = (SCAN_FREQUENCIES as readonly string[]).includes(frequency)
    ? frequency
    : "daily";

  await prisma.scheduledScan.create({
    data: {
      engagementId,
      targets: targets.join("\n"),
      frequency: freq,
      ownerEmail: email,
    },
  });
  revalidatePath("/dashboard/scan");
  redirect("/dashboard/scan");
}

export async function toggleSchedule(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  const s = await prisma.scheduledScan.findUnique({ where: { id } });
  if (s) {
    await prisma.scheduledScan.update({
      where: { id },
      data: { enabled: !s.enabled },
    });
  }
  revalidatePath("/dashboard/scan");
}

export async function deleteSchedule(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  await prisma.scheduledScan.delete({ where: { id } });
  revalidatePath("/dashboard/scan");
}

export async function runScheduleNow(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  const s = await prisma.scheduledScan.findUnique({ where: { id } });
  if (s) await runSchedule(s);
  revalidatePath("/dashboard/scan");
}
