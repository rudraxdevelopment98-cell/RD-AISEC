"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { classifyFinding } from "@/lib/finding-map";

async function requireUser() {
  const session = await auth();
  if (!session?.user) redirect("/login");
}

const STATUSES = ["open", "fixed", "accepted", "false_positive"];

/** Bulk delete selected findings. */
export async function bulkDeleteFindings(formData: FormData) {
  await requireUser();
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (ids.length) await prisma.finding.deleteMany({ where: { id: { in: ids } } });
  revalidatePath("/dashboard/findings");
}

/** Bulk set status on selected findings. */
export async function bulkSetStatus(formData: FormData) {
  await requireUser();
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  const status = String(formData.get("status") ?? "");
  if (ids.length && STATUSES.includes(status)) {
    await prisma.finding.updateMany({ where: { id: { in: ids } }, data: { status } });
  }
  revalidatePath("/dashboard/findings");
}

/** Bulk set category/tag on selected findings. */
export async function bulkSetCategory(formData: FormData) {
  await requireUser();
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  const category = String(formData.get("category") ?? "").trim().slice(0, 60);
  if (ids.length) {
    await prisma.finding.updateMany({ where: { id: { in: ids } }, data: { category } });
  }
  revalidatePath("/dashboard/findings");
}

/** Parse one CSV line respecting quotes. */
function csvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Import findings from a CSV (e.g. one exported earlier, or any tool's export).
 * Recognised headers: Title, Severity, Status, Category, Description,
 * Recommendation. Title is required; everything else optional. Auto-tags
 * ATT&CK/OWASP.
 */
export async function importFindingsCsv(formData: FormData) {
  await requireUser();
  const engagementId = String(formData.get("engagementId") ?? "");
  const file = formData.get("file");
  if (!engagementId) redirect("/dashboard/findings?error=Pick+an+engagement+to+import+into");
  if (!(file instanceof File) || file.size === 0) {
    redirect("/dashboard/findings?error=Choose+a+CSV+file");
  }
  if (file.size > 5_000_000) redirect("/dashboard/findings?error=File+too+large");

  const text = (await file.text()).replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) redirect("/dashboard/findings?error=CSV+has+no+rows");

  const header = csvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.findIndex((h) => h === name);
  const ti = idx("title");
  if (ti < 0) redirect("/dashboard/findings?error=CSV+needs+a+Title+column");
  const si = idx("severity"), sti = idx("status"), ci = idx("category"),
    di = idx("description"), ri = idx("recommendation");
  const SEV = new Set(["info", "low", "medium", "high", "critical"]);

  const rows = lines.slice(1).map(csvLine);
  const data = rows
    .map((r) => {
      const title = (r[ti] ?? "").trim();
      if (!title) return null;
      const severity = SEV.has((r[si] ?? "").trim().toLowerCase())
        ? (r[si] ?? "").trim().toLowerCase()
        : "medium";
      const description = di >= 0 ? (r[di] ?? "").trim() : "";
      return {
        engagementId,
        title,
        severity,
        status: sti >= 0 && r[sti] ? (r[sti] ?? "").trim().toLowerCase() : "open",
        category: ci >= 0 ? (r[ci] ?? "").trim().slice(0, 60) : "",
        description,
        recommendation: ri >= 0 ? (r[ri] ?? "").trim() : "",
        ...classifyFinding({ title, description, severity }),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (data.length === 0) redirect("/dashboard/findings?error=No+valid+rows+found");
  await prisma.finding.createMany({ data });
  await prisma.engagement.update({ where: { id: engagementId }, data: { updatedAt: new Date() } });
  revalidatePath("/dashboard/findings");
  redirect(`/dashboard/findings?ok=${encodeURIComponent(`Imported ${data.length} finding(s)`)}`);
}
