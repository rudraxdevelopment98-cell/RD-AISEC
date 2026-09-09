/**
 * Self-audit — "kya kami reh rahi hai": the engine looking at itself.
 *
 * Reads the live DB + config and reports where coverage is thin so it can be
 * closed: machines behind on the runner, detection templates going stale, tools
 * missing, findings the engine couldn't classify, CVEs that never got threat-intel
 * enrichment, findings stuck un-validated, and confirmed findings not yet
 * submitted (money left on the table). Produces a prioritized digest + a research
 * list of things to teach the engine. Read-only.
 */

import { prisma } from "@/lib/db";
import { RUNNER_VERSION, RUNNER_ONLINE_WINDOW_MS, RUNNER_TOOLS } from "@/lib/runner-constants";

export type AuditLevel = "ok" | "warn" | "gap";
export type AuditItem = { level: AuditLevel; title: string; detail: string; count?: number; action?: string };
export type SelfAudit = {
  generatedAt: string;
  score: number; // 0..100 — higher = healthier
  items: AuditItem[];
  researchList: string[];
};

/** Extract distinct CVE ids from free text. Pure. */
export function cveList(text: string): string[] {
  const out = new Set<string>();
  for (const m of (text || "").matchAll(/CVE-\d{4}-\d{3,7}/gi)) out.add(m[0].toUpperCase());
  return [...out];
}

/** Reduce audit items to a 0..100 health score. Pure. */
export function auditScoreFromItems(items: AuditItem[]): number {
  let penalty = 0;
  for (const it of items) penalty += it.level === "gap" ? 15 : it.level === "warn" ? 6 : 0;
  return Math.max(0, Math.min(100, 100 - penalty));
}

const DAY = 86_400_000;

export async function runSelfAudit(): Promise<SelfAudit> {
  const now = Date.now();
  const items: AuditItem[] = [];
  const research = new Set<string>();

  // 1) Runner version drift — online machines behind the current runner build.
  const runners = await prisma.runner.findMany({
    select: { name: true, version: true, lastSeenAt: true, installed: true, maintUpdatedAt: true },
  });
  const online = runners.filter((r) => r.lastSeenAt && now - new Date(r.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS);
  const behind = online.filter((r) => r.version && r.version !== RUNNER_VERSION);
  if (behind.length) {
    items.push({
      level: "warn",
      title: "Runner update available",
      count: behind.length,
      detail: `${behind.length} online machine(s) are behind v${RUNNER_VERSION}. They self-update; a straggler may need a restart.`,
      action: "Restart the machine, or it updates on its next cycle.",
    });
  } else if (online.length) {
    items.push({ level: "ok", title: "Runners up to date", detail: `All ${online.length} online machine(s) on v${RUNNER_VERSION}.` });
  }

  // 2) Detection freshness — when did any machine last run maintenance (which
  //    refreshes nuclei templates / EPSS / threat-intel / exploit-db)?
  const lastMaint = runners
    .map((r) => (r.maintUpdatedAt ? new Date(r.maintUpdatedAt).getTime() : 0))
    .reduce((a, b) => Math.max(a, b), 0);
  if (!lastMaint) {
    items.push({
      level: "warn",
      title: "Detection templates never refreshed here",
      detail: "No machine has reported a maintenance pass yet. Templates/EPSS/exploit-db refresh in the daily maintenance window.",
      action: "Leave a machine online overnight, or run maintenance from Machines.",
    });
  } else {
    const ageD = Math.floor((now - lastMaint) / DAY);
    items.push(
      ageD <= 2
        ? { level: "ok", title: "Detections fresh", detail: `Templates/intel last refreshed ${ageD === 0 ? "today" : `${ageD}d ago`}.` }
        : {
            level: ageD > 7 ? "gap" : "warn",
            title: "Detections going stale",
            detail: `Last template/intel refresh was ${ageD}d ago — new CVEs/templates may be missed.`,
            action: "Keep a machine online during the maintenance window.",
          },
    );
  }

  // 3) Tool coverage — active allowlisted tools present on no online machine.
  const present = new Set<string>();
  for (const r of online) for (const t of (r.installed || "").split(",").map((s) => s.trim())) if (t) present.add(t);
  const activeTools = RUNNER_TOOLS.filter((t) => t.active).map((t) => t.id);
  const missing = present.size ? activeTools.filter((t) => !present.has(t)) : [];
  if (missing.length) {
    items.push({
      level: missing.length > 8 ? "gap" : "warn",
      title: "Scan tools not installed anywhere",
      count: missing.length,
      detail: `These active tools aren't present on any online machine: ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? "…" : ""}.`,
      action: "Install them from Machines → Tools (or the engine auto-installs on first use).",
    });
  }

  // 4) Findings the engine couldn't classify — the clearest coverage gap.
  const openFindings = await prisma.finding.findMany({
    where: { status: "open" },
    select: { title: true, description: true, category: true, state: true, epss: true, confirmed: true, reviewed: true, severity: true, h1State: true, createdAt: true },
    take: 5000,
  });
  const unclassified = openFindings.filter((f) => !f.state || !f.category);
  if (unclassified.length) {
    items.push({
      level: unclassified.length > 25 ? "gap" : "warn",
      title: "Unclassified findings",
      count: unclassified.length,
      detail: `${unclassified.length} open finding(s) have no engine class/state — the taxonomy or ingest rules don't recognise them yet.`,
      action: "Review these; recurring patterns should become taxonomy/playbook rules.",
    });
    for (const f of unclassified.slice(0, 40)) research.add(`Classify: ${f.title.slice(0, 80)}`);
  }

  // 5) CVEs with no threat-intel enrichment (stale recognition).
  const cveNoIntel = openFindings.filter((f) => f.epss == null && cveList(`${f.title} ${f.description}`).length > 0);
  if (cveNoIntel.length) {
    items.push({
      level: "warn",
      title: "CVEs missing KEV/EPSS enrichment",
      count: cveNoIntel.length,
      detail: `${cveNoIntel.length} finding(s) reference a CVE but have no EPSS/KEV score — intel is stale or the CVE is newer than our feed.`,
      action: "Re-run enrichment after the next intel refresh.",
    });
    for (const f of cveNoIntel.slice(0, 40)) for (const c of cveList(`${f.title} ${f.description}`)) research.add(`Enrich: ${c}`);
  }

  // 6) Findings stuck un-validated (detected/suspected, unconfirmed, aging).
  const stuck = openFindings.filter(
    (f) => (f.state === "detected" || f.state === "suspected") && !f.confirmed && now - new Date(f.createdAt).getTime() > 3 * DAY,
  );
  if (stuck.length) {
    items.push({
      level: "warn",
      title: "Findings awaiting validation",
      count: stuck.length,
      detail: `${stuck.length} finding(s) have sat unconfirmed for 3+ days — validation coverage is lagging behind detection.`,
      action: "Run the exploit/validate step (autopilot does this on authorized engagements).",
    });
  }

  // 7) Confirmed + reviewed but never submitted — earnings left on the table.
  const readyUnsubmitted = openFindings.filter((f) => f.confirmed && f.reviewed && !f.h1State);
  if (readyUnsubmitted.length) {
    items.push({
      level: "gap",
      title: "Confirmed findings not submitted",
      count: readyUnsubmitted.length,
      detail: `${readyUnsubmitted.length} confirmed, reviewed finding(s) haven't been drafted/submitted to a program.`,
      action: "Open each finding → Submit to HackerOne.",
    });
  }

  if (items.length === 0) items.push({ level: "ok", title: "No gaps detected", detail: "The engine looks healthy." });

  return {
    generatedAt: new Date(now).toISOString(),
    score: auditScoreFromItems(items),
    items: items.sort((a, b) => rank(b.level) - rank(a.level)),
    researchList: [...research].slice(0, 60),
  };
}

function rank(l: AuditLevel): number {
  return l === "gap" ? 2 : l === "warn" ? 1 : 0;
}
