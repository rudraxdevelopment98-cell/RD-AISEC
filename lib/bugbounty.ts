"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { parseScopeTargets, platformLabel } from "@/lib/bugbounty-core";
import { isSafeUrl, normalizeTarget, validateTarget } from "@/lib/runner-constants";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { syncHackerOneAccount, queueProgramPipeline } from "@/lib/bug-pipeline";
import { fetchProgramScope } from "@/lib/scope-fetch";
import { ownerScope } from "@/lib/ownership";

const BACK = "/dashboard/bugbounty";

/** Union incoming scope lines into an existing blob (case-insensitive), keeping
 * existing entries first. Never removes — so a resync only ever ADDS newly
 * published targets, and manual edits are preserved. */
function mergeScopeLines(existing: string, incoming: string[]): { text: string; added: number } {
  const lines = (existing ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const seen = new Set(lines.map((l) => l.toLowerCase()));
  let added = 0;
  for (const raw of incoming) {
    const v = String(raw).trim();
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    lines.push(v);
    added++;
  }
  return { text: lines.join("\n"), added };
}

async function requireUser() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/login");
  return email;
}

export async function saveBugAccount(formData: FormData) {
  const email = await requireUser();
  const platform = String(formData.get("platform") ?? "other");
  const handle = String(formData.get("handle") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const apiUser = String(formData.get("apiUser") ?? "").trim();
  const apiTokenRaw = String(formData.get("apiToken") ?? "").trim();
  if (!handle && !url && !apiUser) {
    redirect(`${BACK}?error=${encodeURIComponent("Enter a handle, link, or API username.")}`);
  }
  await prisma.bugAccount.create({
    data: {
      platform,
      handle,
      url,
      apiUser,
      apiToken: apiTokenRaw ? encryptSecret(apiTokenRaw) : "",
      ownerEmail: email,
    },
  });
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${encodeURIComponent("Account saved")}`);
}

/**
 * Pull programs + in-scope assets from HackerOne for a saved account and upsert
 * them as BugPrograms (matched by platform + name). The API token is decrypted
 * server-side only.
 */
export async function syncHackerOne(formData: FormData) {
  const email = await requireUser();
  const id = String(formData.get("id") ?? "");
  const account = await prisma.bugAccount.findUnique({ where: { id } });
  if (!account || account.platform !== "hackerone") {
    redirect(`${BACK}?error=${encodeURIComponent("Not a HackerOne account.")}`);
  }
  if (!account!.apiUser || !account!.apiToken) {
    redirect(`${BACK}?error=${encodeURIComponent("Add your HackerOne API username + token first.")}`);
  }
  const status = await syncHackerOneAccount({
    id: account!.id,
    apiUser: account!.apiUser,
    apiToken: account!.apiToken,
    ownerEmail: email,
  });
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${encodeURIComponent(status)}`);
}

/** Turn automation on/off for a program and pick the machine it runs on. */
export async function setBugAuto(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  const auto = String(formData.get("auto") ?? "") === "true";
  const autoRunnerId = String(formData.get("autoRunnerId") ?? "");
  await prisma.bugProgram.update({ where: { id }, data: { auto, autoRunnerId } });
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${encodeURIComponent(auto ? "Automation enabled" : "Automation paused")}`);
}

/** One click: turn on daily automation for every ENGAGED program, on one machine. */
export async function automateAllPrograms(formData: FormData) {
  await requireUser();
  const runnerId = String(formData.get("runnerId") ?? "");
  if (!runnerId) redirect(`${BACK}?error=${encodeURIComponent("Pick a machine first.")}`);
  // Only programs you've engaged (created an engagement for) get automated.
  const res = await prisma.bugProgram.updateMany({
    where: { status: "active", engagementId: { not: null } },
    data: { auto: true, autoRunnerId: runnerId },
  });
  if (res.count === 0) {
    redirect(`${BACK}?error=${encodeURIComponent("No engaged programs yet — 'Create engagement' on a program first.")}`);
  }
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${encodeURIComponent(`Automation enabled on ${res.count} engaged program(s)`)}`);
}

/** Pause automation on every program. */
export async function pauseAllPrograms() {
  await requireUser();
  await prisma.bugProgram.updateMany({ where: { auto: true }, data: { auto: false } });
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${encodeURIComponent("Automation paused on all programs")}`);
}

/** Run the recon/vuln pipeline for a program now (manual trigger). */
export async function runProgramNow(formData: FormData) {
  const email = await requireUser();
  const id = String(formData.get("id") ?? "");
  const runnerId = String(formData.get("runnerId") ?? "");
  if (!runnerId) redirect(`${BACK}?error=${encodeURIComponent("Pick a machine to scan from.")}`);
  const program = await prisma.bugProgram.findUnique({ where: { id } });
  if (!program) redirect(`${BACK}?error=${encodeURIComponent("Program not found.")}`);

  const n = await queueProgramPipeline(
    {
      id: program!.id,
      name: program!.name,
      platform: program!.platform,
      scope: program!.scope,
      ownerEmail: program!.ownerEmail,
      engagementId: program!.engagementId,
    },
    runnerId,
    email,
    15,
  );
  if (n === 0) {
    redirect(`${BACK}?error=${encodeURIComponent("No new jobs — no scannable targets, or all already queued.")}`);
  }
  redirect(`/dashboard/jobs?queued=${n}`);
}

export async function deleteBugAccount(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  await prisma.bugAccount.delete({ where: { id } });
  revalidatePath(BACK);
}

export async function addBugProgram(formData: FormData) {
  const email = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect(`${BACK}?error=${encodeURIComponent("Program needs a name.")}`);
  await prisma.bugProgram.create({
    data: {
      name,
      platform: String(formData.get("platform") ?? "hackerone"),
      url: String(formData.get("url") ?? "").trim(),
      scope: String(formData.get("scope") ?? "").trim(),
      outScope: String(formData.get("outScope") ?? "").trim(),
      reward: String(formData.get("reward") ?? "").trim(),
      category: String(formData.get("category") ?? "").trim().slice(0, 60),
      notes: String(formData.get("notes") ?? "").trim(),
      ownerEmail: email,
    },
  });
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${encodeURIComponent(`${name} added`)}`);
}

/**
 * Re-fetch a program's scope from its link and merge in anything newly
 * published (scope grows over time). Union-only: existing/manual entries are
 * kept, only new targets are added — so engaged programs never lose scope.
 */
export async function resyncProgramScope(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  const p = await prisma.bugProgram.findUnique({ where: { id } });
  if (!p) redirect(`${BACK}?error=${encodeURIComponent("Program not found.")}`);
  if (!p.url) redirect(`${BACK}?error=${encodeURIComponent(`${p.name}: add a program link first, then resync.`)}`);

  // Reuse a saved HackerOne API token for exact H1 scope.
  let creds: { user: string; token: string } | undefined;
  const acct = await prisma.bugAccount.findFirst({
    where: { platform: "hackerone", apiUser: { not: "" }, apiToken: { not: "" } },
    select: { apiUser: true, apiToken: true },
  });
  if (acct?.apiUser && acct?.apiToken) {
    try {
      creds = { user: acct.apiUser, token: decryptSecret(acct.apiToken) };
    } catch {
      /* scrape instead */
    }
  }

  let result;
  try {
    result = await fetchProgramScope(p.url, creds);
  } catch {
    redirect(`${BACK}?error=${encodeURIComponent(`${p.name}: couldn't read scope from the link.`)}`);
  }
  if (result.inScope.length === 0 && result.outScope.length === 0) {
    redirect(`${BACK}?error=${encodeURIComponent(`${p.name}: no scope found at that link${result.note ? ` — ${result.note}` : "."}`)}`);
  }

  const inMerge = mergeScopeLines(p.scope, result.inScope);
  const outMerge = mergeScopeLines(p.outScope, result.outScope);
  await prisma.bugProgram.update({
    where: { id },
    data: { scope: inMerge.text, outScope: outMerge.text },
  });
  revalidatePath(BACK);
  const added = inMerge.added + outMerge.added;
  redirect(
    `${BACK}?ok=${encodeURIComponent(
      added > 0
        ? `${p.name}: synced — +${inMerge.added} new in-scope, +${outMerge.added} out-of-scope`
        : `${p.name}: scope already up to date`,
    )}`,
  );
}

/**
 * Resync scope for EVERY program that has a link — one button to pull the day's
 * newly published targets across all platforms (HackerOne API + Bugcrowd + any
 * scrapeable link). Union-only merge, same as the per-program resync.
 */
export async function resyncAllProgramScopes() {
  await requireUser();
  const programs = await prisma.bugProgram.findMany({
    where: { url: { not: "" } },
    select: { id: true, name: true, url: true, scope: true, outScope: true },
    orderBy: { updatedAt: "desc" },
  });

  let creds: { user: string; token: string } | undefined;
  const acct = await prisma.bugAccount.findFirst({
    where: { platform: "hackerone", apiUser: { not: "" }, apiToken: { not: "" } },
    select: { apiUser: true, apiToken: true },
  });
  if (acct?.apiUser && acct?.apiToken) {
    try {
      creds = { user: acct.apiUser, token: decryptSecret(acct.apiToken) };
    } catch {
      /* scrape instead */
    }
  }

  let updated = 0;
  let added = 0;
  let failed = 0;
  // Cap so we stay inside the function time budget; the rest can be re-run.
  for (const p of programs.slice(0, 30)) {
    try {
      const r = await fetchProgramScope(p.url, creds);
      if (r.inScope.length === 0 && r.outScope.length === 0) {
        failed++;
        continue;
      }
      const inM = mergeScopeLines(p.scope, r.inScope);
      const outM = mergeScopeLines(p.outScope, r.outScope);
      if (inM.added || outM.added) {
        await prisma.bugProgram.update({
          where: { id: p.id },
          data: { scope: inM.text, outScope: outM.text },
        });
        updated++;
        added += inM.added + outM.added;
      }
    } catch {
      failed++;
    }
  }

  revalidatePath(BACK);
  const parts = [`${added} new target(s) across ${updated} program(s)`];
  if (failed) parts.push(`${failed} couldn't be read (add a token or check the link)`);
  if (programs.length > 30) parts.push(`ran the first 30 of ${programs.length} — click again for the rest`);
  redirect(`${BACK}?ok=${encodeURIComponent(`Resync complete: ${parts.join(" · ")}`)}`);
}

export async function updateBugProgram(formData: FormData) {
  const email = await requireUser();
  const id = String(formData.get("id") ?? "");
  await prisma.bugProgram.updateMany({
    where: { id, ...ownerScope(email) },
    data: {
      scope: String(formData.get("scope") ?? "").trim(),
      outScope: String(formData.get("outScope") ?? "").trim(),
      url: String(formData.get("url") ?? "").trim(),
      category: String(formData.get("category") ?? "").trim().slice(0, 60),
      status: String(formData.get("status") ?? "active"),
    },
  });
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${encodeURIComponent("Program updated")}`);
}

export async function deleteBugProgram(formData: FormData) {
  const email = await requireUser();
  const id = String(formData.get("id") ?? "");
  await prisma.bugProgram.deleteMany({ where: { id, ...ownerScope(email) } });
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${encodeURIComponent("Program removed")}`);
}

const PROGRAM_STATUSES = ["active", "paused", "archived"];

/** Bulk delete selected programs. */
export async function bulkDeletePrograms(formData: FormData) {
  const email = await requireUser();
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (ids.length) await prisma.bugProgram.deleteMany({ where: { id: { in: ids }, ...ownerScope(email) } });
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${encodeURIComponent(`Removed ${ids.length} program(s)`)}`);
}

/** Bulk set category/tag on selected programs. */
export async function bulkSetProgramCategory(formData: FormData) {
  const email = await requireUser();
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  const category = String(formData.get("category") ?? "").trim().slice(0, 60);
  if (ids.length && category) {
    await prisma.bugProgram.updateMany({ where: { id: { in: ids }, ...ownerScope(email) }, data: { category } });
  }
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${encodeURIComponent(`Tagged ${ids.length} program(s)`)}`);
}

/** Bulk set status on selected programs. */
export async function bulkSetProgramStatus(formData: FormData) {
  const email = await requireUser();
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  const status = String(formData.get("status") ?? "");
  if (ids.length && PROGRAM_STATUSES.includes(status)) {
    await prisma.bugProgram.updateMany({ where: { id: { in: ids }, ...ownerScope(email) }, data: { status } });
  }
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${encodeURIComponent(`Updated ${ids.length} program(s)`)}`);
}

/** Create an authorized engagement from a program's scope and link them. */
export async function createEngagementFromProgram(formData: FormData) {
  const email = await requireUser();
  const id = String(formData.get("id") ?? "");
  const program = await prisma.bugProgram.findUnique({ where: { id } });
  if (!program) redirect(`${BACK}?error=${encodeURIComponent("Program not found.")}`);

  const eng = await prisma.engagement.create({
    data: {
      name: program!.name,
      client: platformLabel(program!.platform),
      type: "pentest",
      status: "active",
      category: platformLabel(program!.platform),
      scope: program!.scope,
      authorized: true,
      authorizedBy: `Bug bounty (${platformLabel(program!.platform)})`,
      ownerEmail: email,
    },
  });
  await prisma.bugProgram.update({ where: { id }, data: { engagementId: eng.id } });
  revalidatePath(BACK);
  redirect(`/dashboard/engagements/${eng.id}`);
}
