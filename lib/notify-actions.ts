"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth, isOwnerEmail } from "@/auth";
import { prisma } from "@/lib/db";
import { sendTestNotification } from "@/lib/notify";

const BACK = "/dashboard/settings";

async function requireOwner() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/login");
  if (!isOwnerEmail(email)) redirect(`${BACK}?error=${encodeURIComponent("Owners only.")}`);
  return email;
}

const SEVERITIES = ["info", "low", "medium", "high", "critical"];

export async function saveNotifySetting(formData: FormData) {
  const email = await requireOwner();
  const discordWebhook = String(formData.get("discordWebhook") ?? "").trim();
  const minSeverity = String(formData.get("minSeverity") ?? "high");
  const enabled = String(formData.get("enabled") ?? "") === "true";

  if (discordWebhook && !/^https:\/\//i.test(discordWebhook)) {
    redirect(`${BACK}?error=${encodeURIComponent("Webhook must be an https:// URL.")}`);
  }
  const min = SEVERITIES.includes(minSeverity) ? minSeverity : "high";
  const data = { discordWebhook, minSeverity: min, enabled, ownerEmail: email };

  const existing = await prisma.notifySetting.findFirst();
  if (existing) {
    await prisma.notifySetting.update({ where: { id: existing.id }, data });
  } else {
    await prisma.notifySetting.create({ data });
  }
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${encodeURIComponent("Notification settings saved")}`);
}

/** Save the research/exploit workspace (Drive link + Kali exploit folder). */
export async function saveWorkspace(formData: FormData) {
  const email = await requireOwner();
  const driveUrl = String(formData.get("driveUrl") ?? "").trim();
  const exploitDir = String(formData.get("exploitDir") ?? "").trim();
  if (exploitDir && !exploitDir.startsWith("/")) {
    redirect(`${BACK}?error=${encodeURIComponent("Kali folder must be an absolute path (start with /).")}`);
  }
  if (driveUrl && !/^https:\/\//i.test(driveUrl)) {
    redirect(`${BACK}?error=${encodeURIComponent("Drive link must be an https:// URL.")}`);
  }
  const existing = await prisma.notifySetting.findFirst();
  if (existing) {
    await prisma.notifySetting.update({ where: { id: existing.id }, data: { driveUrl, exploitDir } });
  } else {
    await prisma.notifySetting.create({ data: { driveUrl, exploitDir, ownerEmail: email } });
  }
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${encodeURIComponent("Workspace saved")}`);
}

export async function testNotify() {
  await requireOwner();
  const cfg = await prisma.notifySetting.findFirst();
  if (!cfg?.discordWebhook) {
    redirect(`${BACK}?error=${encodeURIComponent("Save a webhook URL first.")}`);
  }
  const ok = await sendTestNotification(cfg!.discordWebhook);
  redirect(
    `${BACK}?${ok ? "ok=Test+sent — check+your+channel" : "error=Test+failed — check+the+webhook+URL"}`,
  );
}
