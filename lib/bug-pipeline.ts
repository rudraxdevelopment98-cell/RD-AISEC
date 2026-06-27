// Bug-bounty automation engine — plain Node module (Prisma), used by both the
// server actions and the cron. Pipeline: ensure an engagement for the program,
// then queue recon + vuln jobs (auto-imported on completion) for in-scope
// targets. No human in the loop.

import { prisma } from "@/lib/db";
import { parseScopeEntries, platformLabel } from "@/lib/bugbounty-core";
import { normalizeTarget, validateTarget } from "@/lib/runner-constants";
import { decryptSecret } from "@/lib/crypto";
import { fetchPrograms, fetchScope } from "@/lib/hackerone";
import { exploitActions } from "@/lib/exploit-core";

// Recon tools whose findings should trigger automated exploit validation.
// (Excludes searchsploit/sslscan etc. so exploit results don't re-trigger.)
export const RECON_TOOLS = new Set([
  "nmap",
  "nuclei",
  "httpx",
  "gobuster",
  "whatweb",
  "masscan",
  "enum4linux",
]);

// Tools run per in-scope target. `mode` controls the target form: "url" gets an
// http:// prefix (httpx/nuclei/gobuster), "host" gets a bare host (nmap).
// Results auto-import to findings.
type Step = { tool: string; args: string; mode: "url" | "host" };
const PIPELINE: Step[] = [
  { tool: "httpx", args: "-title -status-code -tech-detect", mode: "url" }, // alive + tech
  { tool: "nuclei", args: "-jsonl", mode: "url" }, // templated vulnerabilities
  { tool: "nmap", args: "-Pn -F -T4", mode: "host" }, // top-100 ports + services
  {
    tool: "gobuster",
    args: "dir -q -w /usr/share/wordlists/dirb/common.txt",
    mode: "url",
  }, // content discovery
];

// Deep variant: maximum coverage (all TCP ports + vuln NSE, bigger wordlist,
// plus web-server and TLS scanners). Slower; used by "Deep scan now".
const PIPELINE_DEEP: Step[] = [
  { tool: "httpx", args: "-title -status-code -tech-detect", mode: "url" },
  { tool: "nuclei", args: "-jsonl", mode: "url" },
  { tool: "nmap", args: "-Pn -sV -p- --script vuln -T4", mode: "host" },
  { tool: "gobuster", args: "dir -q -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt", mode: "url" },
  { tool: "nikto", args: "", mode: "url" },
  { tool: "sslscan", args: "", mode: "host" },
];

/** Bare host from any host/URL value. */
function bareHost(v: string): string {
  return v.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0];
}

/** Form a step's target (url-mode adds http://) and validate it for that tool. */
function stepTarget(host: string, step: Step): string | null {
  const bare = bareHost(host);
  if (!bare) return null;
  const target = step.mode === "url" ? `http://${bare}` : bare;
  const normalized = normalizeTarget(step.tool, target);
  return validateTarget(step.tool, normalized) ? normalized : null;
}

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
  const entries = parseScopeEntries(p.scope);
  const queuedBy = email || p.ownerEmail || "automation";

  // Wildcard domains (*.x) get a subdomain-enum job first; discovered hosts are
  // scanned when amass finishes (chained in the runner result route). Plain
  // hosts are scanned directly.
  const wildcards = entries.filter((e) => e.wildcard).map((e) => e.host).slice(0, 5);
  const directHosts = entries.filter((e) => !e.wildcard).map((e) => e.host).slice(0, cap);

  const pending = await prisma.job.findMany({
    where: { engagementId, status: { in: ["queued", "running"] } },
    select: { tool: true, target: true },
  });
  const pendingKey = new Set(pending.map((j) => `${j.tool}|${j.target}`));

  const data: {
    engagementId: string;
    runnerId: string;
    tool: string;
    target: string;
    args: string;
    autoImport: boolean;
    queuedBy: string;
  }[] = [];

  for (const domain of wildcards) {
    if (validateTarget("amass", domain) && !pendingKey.has(`amass|${domain}`)) {
      data.push({ engagementId, runnerId, tool: "amass", target: domain, args: "enum -passive", autoImport: true, queuedBy });
    }
  }
  for (const host of directHosts) {
    for (const step of PIPELINE) {
      const target = stepTarget(host, step);
      if (!target || pendingKey.has(`${step.tool}|${target}`)) continue;
      data.push({ engagementId, runnerId, tool: step.tool, target, args: step.args, autoImport: true, queuedBy });
    }
  }

  if (data.length > 0) await prisma.job.createMany({ data });
  await prisma.bugProgram.update({ where: { id: p.id }, data: { lastAutoAt: new Date() } });
  return data.length;
}

/**
 * Queue the httpx + nuclei steps for a set of hosts under an engagement (used to
 * chain after subdomain enumeration). Deduped against pending jobs. Returns count.
 */
export async function queueHostScans(
  engagementId: string,
  runnerId: string,
  hosts: string[],
  queuedBy: string,
  cap = 15,
  deep = false,
): Promise<number> {
  const picked = hosts.map(bareHost).filter(Boolean).slice(0, cap);
  if (picked.length === 0) return 0;

  const pending = await prisma.job.findMany({
    where: { engagementId, status: { in: ["queued", "running"] } },
    select: { tool: true, target: true },
  });
  const pendingKey = new Set(pending.map((j) => `${j.tool}|${j.target}`));

  const steps = deep ? PIPELINE_DEEP : PIPELINE;
  const data = [];
  for (const host of picked) {
    for (const step of steps) {
      const target = stepTarget(host, step);
      if (!target || pendingKey.has(`${step.tool}|${target}`)) continue;
      data.push({
        engagementId,
        runnerId,
        tool: step.tool,
        target,
        args: step.args,
        autoImport: true,
        queuedBy: queuedBy || "automation",
      });
    }
  }
  if (data.length > 0) await prisma.job.createMany({ data });
  return data.length;
}

/**
 * Auto-exploit: derive validation actions (searchsploit / nmap --script vuln)
 * from fresh recon findings and queue them on the same runner. Deduped against
 * ALL jobs for the engagement (any status) so it converges and never loops.
 * autoImport=true so the results (e.g. "public exploits available") become
 * findings too. Returns the number of jobs queued.
 */
export async function queueExploitJobs(
  engagementId: string,
  runnerId: string,
  findings: { title: string; description?: string | null; severity?: string | null; owasp?: string | null }[],
  queuedBy: string,
  cap = 8,
): Promise<number> {
  const wanted = findings.flatMap((f) => exploitActions(f));
  if (wanted.length === 0) return 0;

  const existing = await prisma.job.findMany({
    where: { engagementId },
    select: { tool: true, target: true, args: true },
  });
  const keyOf = (t: string, tg: string, a: string) => `${t}|${tg}|${a}`;
  const seen = new Set(existing.map((j) => keyOf(j.tool, j.target, j.args)));

  const data = [];
  for (const a of wanted) {
    const target = normalizeTarget(a.tool, a.target);
    if (!validateTarget(a.tool, target)) continue;
    const k = keyOf(a.tool, target, a.args);
    if (seen.has(k)) continue;
    seen.add(k);
    data.push({
      engagementId,
      runnerId,
      tool: a.tool,
      target,
      args: a.args,
      autoImport: true,
      queuedBy: queuedBy || "auto-exploit",
    });
    if (data.length >= cap) break;
  }
  if (data.length > 0) await prisma.job.createMany({ data });
  return data.length;
}

/** Cron: run the pipeline for every auto-enabled program whose interval elapsed. */
export async function runDueBugPrograms(): Promise<{ programs: number; jobs: number }> {
  // Only programs you've ENGAGED (have an engagement) auto-run — never the
  // whole synced catalog.
  const programs = await prisma.bugProgram.findMany({
    where: {
      auto: true,
      status: "active",
      autoRunnerId: { not: "" },
      engagementId: { not: null },
    },
  });
  const now = Date.now();
  let jobs = 0;
  let count = 0;
  for (const p of programs) {
    if (p.lastAutoAt && now - new Date(p.lastAutoAt).getTime() < AUTO_INTERVAL_MS) continue;
    // Only queue if the chosen runner still exists.
    const runner = await prisma.runner.findUnique({ where: { id: p.autoRunnerId } });
    if (!runner) continue;
    jobs += await queueProgramPipeline(p, p.autoRunnerId, p.ownerEmail, 8);
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
