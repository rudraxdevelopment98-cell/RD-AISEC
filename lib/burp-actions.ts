"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { parseBurpIssues } from "@/lib/burp";

const MAX_XML_BYTES = 20 * 1024 * 1024; // 20 MB cap on the upload

/**
 * Import a Burp Suite issues XML export as findings on an engagement.
 * Accepts an uploaded file ("file") or pasted XML ("xml").
 */
export async function importBurpFindings(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const engagementId = String(formData.get("engagementId") ?? "");
  const back = "/dashboard/import";
  if (!engagementId) {
    redirect(`${back}?error=${encodeURIComponent("Choose an engagement first.")}`);
  }

  let xml = String(formData.get("xml") ?? "");
  const file = formData.get("file");
  if (file && typeof file === "object" && "arrayBuffer" in file) {
    const f = file as File;
    if (f.size > 0) {
      if (f.size > MAX_XML_BYTES) {
        redirect(`${back}?error=${encodeURIComponent("File is too large (max 20 MB).")}`);
      }
      xml = Buffer.from(await f.arrayBuffer()).toString("utf8");
    }
  }

  if (!xml.trim()) {
    redirect(`${back}?error=${encodeURIComponent("Paste Burp XML or choose a file.")}`);
  }

  const parsed = parseBurpIssues(xml);
  if (parsed.length === 0) {
    redirect(
      `${back}?error=${encodeURIComponent(
        "No Burp issues found. Export from Burp via Target → Site map → right-click → Report issues (XML), or the Issue activity log.",
      )}`,
    );
  }

  await prisma.finding.createMany({
    data: parsed.map((f) => ({
      engagementId,
      title: f.title,
      severity: f.severity,
      status: f.status,
      description: f.description,
      recommendation: f.recommendation,
    })),
  });
  await prisma.engagement.update({
    where: { id: engagementId },
    data: { updatedAt: new Date() },
  });

  revalidatePath(`/dashboard/engagements/${engagementId}`);
  redirect(`/dashboard/engagements/${engagementId}`);
}
