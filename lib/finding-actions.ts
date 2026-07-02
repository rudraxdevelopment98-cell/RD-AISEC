"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { classifyFinding } from "@/lib/finding-map";
import { learnFromFinding } from "@/lib/suppression";

async function requireUser(): Promise<string> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return session.user.email ?? "";
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
  const email = await requireUser();
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  const status = String(formData.get("status") ?? "");
  if (ids.length && STATUSES.includes(status)) {
    await prisma.finding.updateMany({ where: { id: { in: ids } }, data: { status } });
    // Learn from every finding marked a false positive in bulk.
    if (status === "false_positive") {
      for (const id of ids) await learnFromFinding(id, email).catch(() => {});
    }
  }
  revalidatePath("/dashboard/findings");
}

/** Bulk set category/tag on selected findings. Empty input is ignored so a
 * stray click can't wipe everyone's tags. */
export async function bulkSetCategory(formData: FormData) {
  await requireUser();
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  const category = String(formData.get("category") ?? "").trim().slice(0, 60);
  if (ids.length && category) {
    await prisma.finding.updateMany({ where: { id: { in: ids } }, data: { category } });
  }
  revalidatePath("/dashboard/findings");
}

/** Parse a whole CSV into records, honoring quoted fields that span newlines. */
function parseCsvRecords(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  const pushRow = () => {
    row.push(cur);
    cur = "";
    if (row.length > 1 || row[0].trim() !== "") rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else cur += c;
  }
  if (cur !== "" || row.length) pushRow();
  return rows;
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
  const records = parseCsvRecords(text);
  if (records.length < 2) redirect("/dashboard/findings?error=CSV+has+no+rows");

  const header = records[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.findIndex((h) => h === name);
  const ti = idx("title");
  if (ti < 0) redirect("/dashboard/findings?error=CSV+needs+a+Title+column");
  const si = idx("severity"), sti = idx("status"), ci = idx("category"),
    di = idx("description"), ri = idx("recommendation");
  const SEV = new Set(["info", "low", "medium", "high", "critical"]);
  const STA = new Set(STATUSES);

  const data = records
    .slice(1)
    .map((r) => {
      const title = (r[ti] ?? "").trim();
      if (!title) return null;
      const severity = SEV.has((r[si] ?? "").trim().toLowerCase())
        ? (r[si] ?? "").trim().toLowerCase()
        : "medium";
      const rawStatus = (r[sti] ?? "").trim().toLowerCase();
      const description = di >= 0 ? (r[di] ?? "").trim() : "";
      return {
        engagementId,
        title: title.slice(0, 300),
        severity,
        status: sti >= 0 && STA.has(rawStatus) ? rawStatus : "open",
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
