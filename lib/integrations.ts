"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth, isOwnerEmail } from "@/auth";
import { prisma } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import { buildHackerOneReport } from "@/lib/report/hackerone";
import { createReportIntent, submitReportIntent, verifyCreds, type H1Creds } from "@/lib/report/hackerone-api";

async function requireUser(): Promise<string> {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  return session.user.email;
}

export type H1Status = { configured: boolean; username: string; handle: string };

/** Non-secret status of the owner's HackerOne integration (for the settings UI). */
export async function getHackerOneStatus(): Promise<H1Status> {
  const email = await requireUser();
  const row = await prisma.integration.findUnique({
    where: { ownerEmail_kind: { ownerEmail: email, kind: "hackerone" } },
  });
  return { configured: !!row?.secret, username: row?.username ?? "", handle: row?.handle ?? "" };
}

async function loadCreds(email: string): Promise<{ creds: H1Creds; handle: string } | null> {
  const row = await prisma.integration.findUnique({
    where: { ownerEmail_kind: { ownerEmail: email, kind: "hackerone" } },
  });
  if (!row?.secret || !row.username) return null;
  return { creds: { username: row.username, token: decryptSecret(row.secret) }, handle: row.handle };
}

/** Save / clear HackerOne API credentials (owner-only). Token stored encrypted. */
export async function saveHackerOneCreds(formData: FormData) {
  const email = await requireUser();
  const back = "/dashboard/settings";
  if (!isOwnerEmail(email)) redirect(`${back}?error=${encodeURIComponent("Only an owner can set integrations.")}`);

  const username = String(formData.get("username") ?? "").trim().slice(0, 120);
  const token = String(formData.get("token") ?? "").trim();
  const handle = String(formData.get("handle") ?? "").trim().slice(0, 120);
  const clear = String(formData.get("clear") ?? "") === "1";

  if (clear) {
    await prisma.integration.deleteMany({ where: { ownerEmail: email, kind: "hackerone" } });
    await logAudit({ type: "integration.hackerone.cleared", actor: email, summary: "Cleared HackerOne credentials" });
    redirect(`${back}?ok=${encodeURIComponent("HackerOne integration cleared.")}`);
  }

  if (!username) {
    redirect(`${back}?error=${encodeURIComponent("Enter the HackerOne API username.")}`);
  }

  // Blank token + already configured → keep the stored token, just update the
  // username/handle (verify with the existing token).
  const existing = await prisma.integration.findUnique({
    where: { ownerEmail_kind: { ownerEmail: email, kind: "hackerone" } },
  });
  const effectiveToken = token || (existing?.secret ? decryptSecret(existing.secret) : "");
  if (!effectiveToken) {
    redirect(`${back}?error=${encodeURIComponent("Enter the HackerOne API token.")}`);
  }

  // Verify before saving so a bad token is caught now, not at submit time.
  const check = await verifyCreds({ username, token: effectiveToken });
  if (!check.ok) {
    redirect(`${back}?error=${encodeURIComponent(`HackerOne rejected those credentials: ${check.error}`)}`);
  }

  await prisma.integration.upsert({
    where: { ownerEmail_kind: { ownerEmail: email, kind: "hackerone" } },
    create: { ownerEmail: email, kind: "hackerone", username, secret: encryptSecret(effectiveToken), handle },
    update: { username, secret: encryptSecret(effectiveToken), handle },
  });
  await logAudit({ type: "integration.hackerone.set", actor: email, summary: `Saved HackerOne credentials (${username})` });
  revalidatePath(back);
  redirect(`${back}?ok=${encodeURIComponent("HackerOne credentials verified and saved.")}`);
}

/** First in-scope host/URL of an engagement — the finding's affected asset anchor. */
function firstAsset(scope: string): string {
  const line = scope.split(/[\r\n,]+/).map((s) => s.trim()).find((s) => s.length > 0);
  return line ?? "";
}

/**
 * Create a HackerOne DRAFT (report intent) for a finding. Owner-gated. Nothing is
 * publicly submitted here — the draft waits for explicit approval (submitHackerOneDraft).
 */
export async function createHackerOneDraft(formData: FormData) {
  const email = await requireUser();
  const id = String(formData.get("id") ?? "");
  const teamHandleIn = String(formData.get("teamHandle") ?? "").trim();
  const back = `/dashboard/findings/${id}/exploit`;

  const finding = await prisma.finding.findUnique({
    where: { id },
    include: { engagement: { select: { ownerEmail: true, scope: true } } },
  });
  if (!finding) redirect(`${back}?error=${encodeURIComponent("Finding not found.")}`);
  const eng = finding!.engagement;
  if (eng.ownerEmail && eng.ownerEmail !== email) {
    redirect(`${back}?error=${encodeURIComponent("Only the engagement owner can create a submission.")}`);
  }

  const loaded = await loadCreds(email);
  if (!loaded) {
    redirect(`${back}?error=${encodeURIComponent("Add your HackerOne API credentials in Settings first.")}`);
  }
  const teamHandle = teamHandleIn || loaded!.handle;
  if (!teamHandle) {
    redirect(`${back}?error=${encodeURIComponent("Enter the HackerOne program handle (or set a default in Settings).")}`);
  }

  const report = buildHackerOneReport(finding!, { asset: firstAsset(eng.scope) });
  const res = await createReportIntent(loaded!.creds, teamHandle, report.title, report.description);
  if (!res.ok) {
    redirect(`${back}?error=${encodeURIComponent(`HackerOne draft failed: ${res.error}`)}`);
  }

  await prisma.finding.update({
    where: { id },
    data: { h1State: "draft", h1IntentId: res.data.id, h1Url: "" },
  });
  await logAudit({
    type: "finding.hackerone.draft",
    actor: email,
    summary: `Created HackerOne draft for finding on program "${teamHandle}"`,
    target: id,
  });
  revalidatePath(back);
  redirect(`${back}?ok=${encodeURIComponent("HackerOne draft created. Review it, then approve to submit.")}`);
}

/**
 * SUBMIT an existing HackerOne draft — the human approval step. Owner-gated and
 * requires the finding to be reviewed (sign-off) first. This is the only action
 * that publicly files the report.
 */
export async function submitHackerOneDraft(formData: FormData) {
  const email = await requireUser();
  const id = String(formData.get("id") ?? "");
  const back = `/dashboard/findings/${id}/exploit`;

  const finding = await prisma.finding.findUnique({
    where: { id },
    include: { engagement: { select: { ownerEmail: true } } },
  });
  if (!finding) redirect(`${back}?error=${encodeURIComponent("Finding not found.")}`);
  if (finding!.engagement.ownerEmail && finding!.engagement.ownerEmail !== email) {
    redirect(`${back}?error=${encodeURIComponent("Only the engagement owner can submit.")}`);
  }
  if (finding!.h1State !== "draft" || !finding!.h1IntentId) {
    redirect(`${back}?error=${encodeURIComponent("Create a draft first.")}`);
  }
  if (!finding!.reviewed) {
    redirect(`${back}?error=${encodeURIComponent("Sign off (review) this finding before submitting it.")}`);
  }

  const loaded = await loadCreds(email);
  if (!loaded) redirect(`${back}?error=${encodeURIComponent("HackerOne credentials are missing.")}`);

  const res = await submitReportIntent(loaded!.creds, finding!.h1IntentId);
  if (!res.ok) {
    redirect(`${back}?error=${encodeURIComponent(`HackerOne submit failed: ${res.error}`)}`);
  }

  await prisma.finding.update({
    where: { id },
    data: { h1State: "submitted", h1ReportId: res.data.reportId, h1Url: res.data.url, submittedAt: new Date() },
  });
  await logAudit({
    type: "finding.hackerone.submitted",
    actor: email,
    summary: `Submitted finding to HackerOne (report ${res.data.reportId || "?"})`,
    target: id,
  });
  revalidatePath(back);
  redirect(`${back}?ok=${encodeURIComponent("Submitted to HackerOne." + (res.data.url ? ` ${res.data.url}` : ""))}`);
}
