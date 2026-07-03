"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { EVIDENCE_KINDS, CUSTODY_ACTIONS, HASH_ALGOS, isValidHash } from "@/lib/forensics-core";

async function requireEmail(): Promise<string> {
  const s = await auth();
  if (!s?.user?.email) redirect("/login");
  return s.user.email;
}
const oneOf = <T extends readonly string[]>(v: FormDataEntryValue | null, opts: T, def: T[number]) =>
  opts.includes(String(v ?? "") as T[number]) ? (String(v) as T[number]) : def;
const engPath = (id: string) => `/dashboard/engagements/${id}`;

/** Register a new evidence item + open its chain of custody with an "acquired" link. */
export async function addEvidence(formData: FormData): Promise<void> {
  const email = await requireEmail();
  const engagementId = String(formData.get("engagementId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!engagementId || !name) redirect(`${engPath(engagementId)}?error=${encodeURIComponent("Evidence needs a name.")}`);

  const hashAlgo = oneOf(formData.get("hashAlgo"), HASH_ALGOS, "sha256");
  const hashValue = String(formData.get("hashValue") ?? "").trim().toLowerCase();
  if (!isValidHash(hashAlgo, hashValue)) {
    redirect(`${engPath(engagementId)}?error=${encodeURIComponent(`That doesn't look like a valid ${hashAlgo} hash.`)}`);
  }
  const acquiredBy = String(formData.get("acquiredBy") ?? "").trim() || email;

  const ev = await prisma.evidence.create({
    data: {
      engagementId,
      name,
      kind: oneOf(formData.get("kind"), EVIDENCE_KINDS, "file"),
      source: String(formData.get("source") ?? "").trim(),
      hashAlgo,
      hashValue,
      size: String(formData.get("size") ?? "").trim(),
      storage: String(formData.get("storage") ?? "").trim(),
      acquiredBy,
      notes: String(formData.get("notes") ?? "").trim(),
      custody: { create: { action: "acquired", actor: acquiredBy, notes: "Evidence acquired & registered." } },
    },
  });
  await logAudit({ type: "evidence.added", actor: email, summary: `Registered evidence "${name}"`, target: ev.id });
  revalidatePath(engPath(engagementId));
  redirect(`${engPath(engagementId)}?ok=${encodeURIComponent("Evidence registered")}#evidence`);
}

/** Add a chain-of-custody event to an evidence item. */
export async function addCustody(formData: FormData): Promise<void> {
  const email = await requireEmail();
  const evidenceId = String(formData.get("evidenceId") ?? "");
  const engagementId = String(formData.get("engagementId") ?? "");
  if (!evidenceId) return;
  await prisma.custodyEvent.create({
    data: {
      evidenceId,
      action: oneOf(formData.get("action"), CUSTODY_ACTIONS, "note"),
      actor: String(formData.get("actor") ?? "").trim() || email,
      notes: String(formData.get("notes") ?? "").trim(),
    },
  });
  revalidatePath(engPath(engagementId));
  redirect(`${engPath(engagementId)}#evidence`);
}

export async function deleteEvidence(formData: FormData): Promise<void> {
  const email = await requireEmail();
  const id = String(formData.get("id") ?? "");
  const engagementId = String(formData.get("engagementId") ?? "");
  if (id) await prisma.evidence.delete({ where: { id } }).catch(() => {});
  await logAudit({ type: "evidence.deleted", actor: email, summary: `Deleted evidence ${id}`, severity: "warn" });
  revalidatePath(engPath(engagementId));
  redirect(`${engPath(engagementId)}#evidence`);
}
