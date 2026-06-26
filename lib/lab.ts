"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

const BACK = "/dashboard/lab";

/**
 * Save a generated exploit/script into the configured Kali exploit folder via
 * the runner (a "savefile" job). The path is constrained to the workspace folder
 * and the filename is sanitized.
 */
export async function saveExploitToKali(formData: FormData) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/login");

  const runnerId = String(formData.get("runnerId") ?? "");
  const filename = String(formData.get("filename") ?? "").trim();
  const content = String(formData.get("content") ?? "");

  const cfg = await prisma.notifySetting.findFirst();
  const dir = (cfg?.exploitDir ?? "").trim();
  if (!dir) redirect(`${BACK}?error=${encodeURIComponent("Set a Kali exploit folder in Settings first.")}`);
  if (!runnerId) redirect(`${BACK}?error=${encodeURIComponent("Pick a machine.")}`);
  if (!content.trim()) redirect(`${BACK}?error=${encodeURIComponent("Nothing to save.")}`);

  // Sanitize the filename — no slashes or traversal.
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 100);
  if (!safe) redirect(`${BACK}?error=${encodeURIComponent("Enter a valid filename.")}`);
  if (content.length > 100_000) {
    redirect(`${BACK}?error=${encodeURIComponent("Script too large (max 100 KB).")}`);
  }

  const path = `${dir!.replace(/\/+$/, "")}/${safe}`;
  const b64 = Buffer.from(content, "utf8").toString("base64");

  await prisma.job.create({
    data: {
      runnerId,
      tool: "savefile",
      target: path,
      args: b64,
      queuedBy: email,
    },
  });

  revalidatePath("/dashboard/jobs");
  redirect(`/dashboard/jobs?queued=1`);
}
