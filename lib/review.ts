"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isOwnerEmail } from "@/lib/members";

const back = (id: string) => `/dashboard/findings/${id}/exploit`;

/**
 * Human-review sign-off: an owner approves (or withdraws approval for) a
 * high-impact finding before it's published/submitted. Owner-only — this is the
 * human-oversight gate, so automation can never self-approve.
 */
export async function setFindingReviewed(formData: FormData) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/login");
  const findingId = String(formData.get("findingId") ?? "");
  const reviewed = String(formData.get("reviewed") ?? "") === "true";
  if (!isOwnerEmail(email)) {
    redirect(`${back(findingId)}?error=${encodeURIComponent("Only an owner can approve a finding for publication.")}`);
  }
  const finding = await prisma.finding.findUnique({ where: { id: findingId } });
  if (!finding) redirect("/dashboard/findings");

  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const note = reviewed
    ? `\n\n[Reviewed & approved for publication by ${email} on ${stamp}]`
    : `\n\n[Review approval withdrawn by ${email} on ${stamp}]`;
  await prisma.finding.update({
    where: { id: findingId },
    data: { reviewed, description: (finding.description || "") + note },
  });
  revalidatePath(back(findingId));
  redirect(`${back(findingId)}?ok=${encodeURIComponent(reviewed ? "Approved for publication" : "Approval withdrawn")}`);
}
