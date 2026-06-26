// Bug-bounty automation engine — plain Node module (Prisma), used by both the
// server actions and the cron. Pipeline: ensure an engagement for the program,
// then queue recon + vuln jobs (auto-imported on completion) for in-scope
// targets. No human in the loop.

import { prisma } from "@/lib/db";
import { parseScopeTargets, platformLabel } from "@/lib/bugbounty-core";
import { normalizeTarget, validateTarget } from "@/lib/runner-constants";
import { decryptSecret } from "@/lib/crypto";
import { fetchPrograms, fetchScope } from "@/lib/hackerone";

// Tools run per in-scope target. URL-based; results auto-import to findings.
const PIPELINE: { tool: string; args: string }[] = [
  { tool: "httpx", args: "-title -status-code -tech-detect" }, // alive + tech
  { tool: "nuclei", args: "-jsonl" }, // templated vulnerabilities
];

const AUTO_INTERVAL_MS = 20 * 60 * 60 * 1000; // ~daily

type Program = {
  id: string;
  name: string;
  platform: string;
  scope: string;
  ownerEmail: string;
  engagementId: string | null;
};

/** Ensure the program has a linked authorized engagement; return its id. */
export async function ensureEngagement(p: Program, email: string): Promise<string> {
  if (p.engagementId) {
    const exists = await prisma.engagement.findUnique({ where: { id: p.engagementId } });
    if (exists) return p.engagementId;
  }
  const eng = await prisma.engagement.create({
    data: {
      name: p.name,
      client: platformLabel(p.platform),
      type: "pentest",
      status: "active",
      scope: p.scope,
      authorized: true,
      authorizedBy: `Bug bounty (${platformLabel(p.platform)})`,
      ownerEmail: email || p.ownerEmail,
    },
  });
  await prisma.bugProgram.update({ where: { id: p.id }, data: { engagementId: eng.id } });
  return eng.id;
}

/**
 * Queue the pipeline for one program's in-scope targets on a runner. Skips a
 * (tool,target) that already has a queued/running job so repeated runs don't
 * pile up. Returns the number of jobs queued.
 */
export async function queueProgramPipeline(
  p: Program,
  runnerId: string,
  email: string,
  cap = 15,
): Promise<number> {
  const engagementId = await ensureEngagement(p, email);
  const targets = parseScopeTargets(p.scope)
    .map((t) => normalizeTarget("httpx", t))
    .filter((t) => validateTarget("httpx", t))
    .slice(0, cap);
  if (targets.length === 0) return 0;

  // What's already pending for this engagement, to avoid duplicates.
  const pending = await prisma.job.findMany({
    where: { engagementId, status: { in: ["queued", "running"] } },
    select: { tool: true, target: true },
  });
  const pendingKey = new Set(pending.map((j) => `${j.tool}|${j.target}`));

  const data = [];
  for (const target of targets) {
    for (const step of PIPELINE) {
      if (pendingKey.has(`${step.tool}|${target}`)) continue;
      data.push({
        engagementId,
        runnerId,
        tool: step.tool,
        target,
        args: step.args,
        autoImport: true,
        queuedBy: email || p.ownerEmail || "automation",
      });
    }
  }
  if (data.length > 0) await prisma.job.createMany({ data });
  await prisma.bugProgram.update({ where: { id: p.id }, data: { lastAutoAt: new Date() } });
  return data.length;
}

/** Cron: run the pipeline for every auto-enabled program whose interval elapsed. */
export async function runDueBugPrograms(): Promise<{ programs: number; jobs: number }> {
  const programs = await prisma.bugProgram.findMany({
    where: { auto: true, status: "active", autoRunnerId: { not: "" } },
  });
  const now = Date.now();
  let jobs = 0;
  let count = 0;
  for (const p of programs) {
    if (p.lastAutoAt && now - new Date(p.lastAutoAt).getTime() < AUTO_INTERVAL_MS) continue;
    // Only queue if the chosen runner still exists.
    const runner = await prisma.runner.findUnique({ where: { id: p.autoRunnerId } });
    if (!runner) continue;
    jobs += await queueProgramPipeline(p, p.autoRunnerId, p.ownerEmail, 10);
    count += 1;
  }
  return { programs: count, jobs };
}

/** Sync one HackerOne account's programs + scopes into BugProgram. Returns a status. */
export async function syncHackerOneAccount(account: {
  id: string;
  apiUser: string;
  apiToken: string;
  ownerEmail: string;
}): Promise<string> {
  const token = decryptSecret(account.apiToken);
  if (!account.apiUser || !token) return "Missing API username/token.";
  let status: string;
  try {
    const programs = await fetchPrograms(account.apiUser, token);
    let imported = 0;
    for (const pr of programs) {
      let scope: string[] = [];
      try {
        scope = await fetchScope(account.apiUser, token, pr.handle);
      } catch {
        /* skip this program's scope */
      }
      const existing = await prisma.bugProgram.findFirst({
        where: { platform: "hackerone", name: pr.name },
      });
      const base = {
        platform: "hackerone",
        name: pr.name,
        url: `https://hackerone.com/${pr.handle}`,
        scope: scope.join("\n"),
        ownerEmail: account.ownerEmail,
      };
      if (existing) {
        await prisma.bugProgram.update({
          where: { id: existing.id },
          data: scope.length ? base : { url: base.url },
        });
      } else {
        await prisma.bugProgram.create({ data: base });
      }
      imported += 1;
    }
    status = `Synced ${imported} program(s).`;
  } catch (err) {
    status = err instanceof Error ? err.message : "Sync failed.";
  }
  await prisma.bugAccount.update({
    where: { id: account.id },
    data: { lastSyncAt: new Date(), lastSyncStatus: status },
  });
  return status;
}

/** Cron: sync every HackerOne account that has API credentials. */
export async function runDueHackerOneSyncs(): Promise<number> {
  const accounts = await prisma.bugAccount.findMany({
    where: { platform: "hackerone", apiToken: { not: "" } },
  });
  let n = 0;
  for (const a of accounts) {
    await syncHackerOneAccount(a);
    n += 1;
  }
  return n;
}
