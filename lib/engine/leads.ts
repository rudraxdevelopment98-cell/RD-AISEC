// Gather an engagement's accumulated FACTS from what the engine already stored
// (findings, crawl endpoints, httpx tech) and run the deterministic correlation
// engine over them → a ranked list of leads ("what to look at next"). This is the
// Target Knowledge Base working-memory read: no AI, no cost, pure DB + correlate.

import { prisma } from "@/lib/db";
import { correlate, type Fact, type Lead, type Relation } from "@/lib/engine/correlate";
import { extractEndpoints } from "@/lib/recon-extract";
import { classifyFindingVuln } from "@/lib/vuln-taxonomy";
import { hostFromTitle } from "@/lib/suppression-core";

// Tools whose stored output carries a URL surface worth mining for endpoints.
const ENDPOINT_TOOLS = ["katana", "gau", "gospider", "waybackurls", "hakrawler", "httpx", "gobuster", "ffuf", "arjun"];

function bareHost(v: string): string {
  return (v || "").replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0].split(":")[0].toLowerCase();
}

/** Parse httpx `-tech-detect` lines: "https://h [200] [Title] [Nginx,PHP,...]". */
function techFromHttpx(output: string, target: string): Fact[] {
  const out: Fact[] = [];
  for (const line of (output || "").split("\n").slice(0, 500)) {
    const url = line.match(/https?:\/\/[^\s\]]+/)?.[0];
    const host = url ? bareHost(url) : bareHost(target);
    // The LAST [..] group on a tech-detect line is the tech list.
    const groups = [...line.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
    const techList = groups.length ? groups[groups.length - 1] : "";
    if (host && /[a-z]/i.test(techList) && !/^\d+$/.test(techList)) {
      for (const name of techList.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8)) {
        out.push({ kind: "tech", host, name });
      }
    }
  }
  return out;
}

export type LeadsResult = { leads: Lead[]; relations: Relation[]; factCount: number };

/**
 * Build the fact set for an engagement and correlate it into leads. Bounded reads
 * (recent done jobs, capped outputs) so it's cheap to call from a page or a loop.
 */
export async function engagementLeads(engagementId: string): Promise<LeadsResult> {
  if (!engagementId) return { leads: [], relations: [], factCount: 0 };

  const [findings, jobs] = await Promise.all([
    prisma.finding.findMany({
      where: { engagementId },
      select: { title: true, description: true, confirmed: true },
      take: 500,
    }),
    prisma.job.findMany({
      where: { engagementId, status: "done", tool: { in: ENDPOINT_TOOLS } },
      select: { tool: true, target: true, output: true },
      orderBy: { finishedAt: "desc" },
      take: 40,
    }),
  ]);

  const facts: Fact[] = [];

  // Endpoints (capped) + tech from the stored crawl/httpx output.
  const seenUrl = new Set<string>();
  for (const j of jobs) {
    if (j.tool === "httpx") facts.push(...techFromHttpx(j.output, j.target));
    for (const u of extractEndpoints(j.output ?? "", j.target)) {
      if (seenUrl.has(u)) continue;
      seenUrl.add(u);
      facts.push({ kind: "endpoint", url: u });
      if (seenUrl.size >= 2000) break; // hard cap so correlate stays fast
    }
    if (seenUrl.size >= 2000) break;
  }

  // Findings → facts (host from title, class from the taxonomy).
  for (const f of findings) {
    const host = hostFromTitle(f.title) || "";
    const cls = classifyFindingVuln({ title: f.title, description: f.description ?? "" })?.id ?? "misc";
    facts.push({ kind: "finding", host, cls, title: f.title, confirmed: !!f.confirmed });
  }

  const { relations, leads } = correlate(facts);
  return { leads, relations, factCount: facts.length };
}
