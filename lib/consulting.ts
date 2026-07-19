"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { CONTROL_STATUSES, getFramework } from "@/lib/consulting-core";

async function requireEmail(): Promise<string> {
  const s = await auth();
  if (!s?.user?.email) redirect("/login");
  return s.user.email;
}
const engPath = (id: string) => `/dashboard/engagements/${id}`;

/** Create an assessment, seeding its controls from the chosen framework template. */
export async function createAssessment(formData: FormData): Promise<void> {
  const email = await requireEmail();
  const engagementId = String(formData.get("engagementId") ?? "");
  const frameworkId = String(formData.get("framework") ?? "custom");
  const fw = getFramework(frameworkId);
  const name = String(formData.get("name") ?? "").trim() || (fw ? `${fw.name} assessment` : "Assessment");
  if (!engagementId) return;

  await prisma.assessment.create({
    data: {
      engagementId,
      name,
      framework: fw?.id ?? "custom",
      controls: {
        create: (fw?.controls ?? []).map((c) => ({ controlId: c.id, domain: c.domain, title: c.title })),
      },
    },
  });
  await logAudit({ type: "assessment.created", actor: email, summary: `Created assessment "${name}"` });
  revalidatePath(engPath(engagementId));
  redirect(`${engPath(engagementId)}?ok=${encodeURIComponent("Assessment created")}#assessment`);
}

/** Update one control's status / maturity / notes / recommendation. */
export async function setControl(formData: FormData): Promise<void> {
  await requireEmail();
  const id = String(formData.get("id") ?? "");
  const engagementId = String(formData.get("engagementId") ?? "");
  if (!id) return;
  const status = CONTROL_STATUSES.includes(String(formData.get("status") ?? "") as (typeof CONTROL_STATUSES)[number])
    ? String(formData.get("status"))
    : undefined;
  const maturity = Math.max(0, Math.min(5, parseInt(String(formData.get("maturity") ?? ""), 10) || 0));
  // Surface a real save failure instead of silently redirecting as success — the
  // engagement page renders ?error=. (redirect() throws internally, so it must run
  // outside the try/catch.)
  let saveFailed = false;
  try {
    await prisma.controlResult.update({
      where: { id },
      data: {
        ...(status ? { status } : {}),
        maturity,
        notes: String(formData.get("notes") ?? ""),
        recommendation: String(formData.get("recommendation") ?? ""),
      },
    });
  } catch {
    saveFailed = true;
  }
  revalidatePath(engPath(engagementId));
  if (saveFailed) {
    redirect(`${engPath(engagementId)}?error=${encodeURIComponent("Couldn't save the control — please try again.")}#assessment`);
  }
  redirect(`${engPath(engagementId)}#assessment`);
}

/** Add a custom control to an assessment. */
export async function addControl(formData: FormData): Promise<void> {
  await requireEmail();
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const engagementId = String(formData.get("engagementId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!assessmentId || !title) return;
  await prisma.controlResult.create({
    data: {
      assessmentId,
      controlId: `custom-${Date.now()}`,
      domain: String(formData.get("domain") ?? "").trim() || "Custom",
      title,
    },
  });
  revalidatePath(engPath(engagementId));
  redirect(`${engPath(engagementId)}#assessment`);
}

export async function deleteAssessment(formData: FormData): Promise<void> {
  const email = await requireEmail();
  const id = String(formData.get("id") ?? "");
  const engagementId = String(formData.get("engagementId") ?? "");
  if (id) await prisma.assessment.delete({ where: { id } }).catch(() => {});
  await logAudit({ type: "assessment.deleted", actor: email, summary: `Deleted assessment ${id}`, severity: "warn" });
  revalidatePath(engPath(engagementId));
  redirect(`${engPath(engagementId)}#assessment`);
}
