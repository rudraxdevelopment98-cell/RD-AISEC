// Engagement readiness diagnostics — answers "why am I not finding bugs?" by
// checking the operational prerequisites: a runner online, the right tools
// installed, authorization recorded, scannable scope, and recent job failures.
// Plain module (Prisma) — imported by the engagement server component.

import { prisma } from "@/lib/db";
import { RUNNER_ONLINE_WINDOW_MS, RUNNER_VERSION } from "@/lib/runner-constants";
import { parseScopeTargets } from "@/lib/bugbounty-core";

export type Check = {
  id: string;
  label: string;
  level: "ok" | "warn" | "fail";
  detail: string;
  fixHref?: string;
  fixLabel?: string;
};

export type Readiness = {
  checks: Check[];
  okCount: number;
  failCount: number;
  warnCount: number;
  // One-click install support: tools missing across online runners.
  canInstall: boolean;
  missingTools: string[];
};

// All tools the engine relies on, in install priority order.
export const REQUIRED_TOOL_IDS = [
  "nuclei", "httpx", "nmap", "gobuster", "nikto", "sslscan",
  "searchsploit", "sqlmap", "wpscan", "metasploit",
];

// Tools the scan/exploit engine relies on, by role.
const SCAN_TOOLS: { id: string; name: string }[] = [
  { id: "nuclei", name: "nuclei" },
  { id: "httpx", name: "httpx" },
  { id: "nmap", name: "nmap" },
  { id: "gobuster", name: "gobuster" },
  { id: "nikto", name: "nikto" },
  { id: "sslscan", name: "sslscan" },
];
const EXPLOIT_TOOLS: { id: string; name: string }[] = [
  { id: "searchsploit", name: "searchsploit" },
  { id: "sqlmap", name: "sqlmap" },
  { id: "wpscan", name: "wpscan" },
  { id: "metasploit", name: "metasploit" },
];

export async function engagementReadiness(eng: {
  id: string;
  authorized: boolean;
  scope: string;
}): Promise<Readiness> {
  const now = Date.now();
  const [runners, failed, total] = await Promise.all([
    prisma.runner.findMany({
      select: { name: true, lastSeenAt: true, version: true, installed: true },
    }),
    prisma.job.findMany({
      where: { engagementId: eng.id, status: "failed" },
      orderBy: { finishedAt: "desc" },
      take: 5,
      select: { tool: true, target: true, output: true },
    }),
    prisma.job.count({ where: { engagementId: eng.id } }),
  ]);

  const online = runners.filter(
    (r) => r.lastSeenAt && now - new Date(r.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS,
  );
  // Tools installed across all online runners (union).
  const installed = new Set<string>();
  for (const r of online) {
    for (const t of (r.installed || "").split(",").map((s) => s.trim()).filter(Boolean)) {
      installed.add(t);
    }
  }

  const checks: Check[] = [];

  // 1. Runner online.
  if (online.length > 0) {
    checks.push({
      id: "runner",
      label: `Runner online (${online.map((r) => r.name).join(", ")})`,
      level: "ok",
      detail: "A Kali machine is connected and polling for jobs.",
    });
  } else {
    checks.push({
      id: "runner",
      label: "No runner online",
      level: "fail",
      detail:
        runners.length === 0
          ? "No machine is registered. Register your Kali box and start the runner."
          : "A runner is registered but hasn't polled recently — start/reconnect it.",
      fixHref: "/dashboard/runners",
      fixLabel: "Set up runner",
    });
  }

  // 2. Runner up to date.
  if (online.length > 0 && online.some((r) => r.version && r.version !== RUNNER_VERSION)) {
    checks.push({
      id: "version",
      label: "Runner script out of date",
      level: "warn",
      detail: `One or more runners report an older version (current is v${RUNNER_VERSION}). Re-pull rdaisec_runner.py to get the latest tools, parsers, and nuclei auto-update.`,
      fixHref: "/dashboard/runners",
      fixLabel: "Update runner",
    });
  }

  // 3. Scan tools installed (only meaningful if a runner is online).
  if (online.length > 0) {
    const missingScan = SCAN_TOOLS.filter((t) => !installed.has(t.id));
    checks.push({
      id: "scan-tools",
      label: missingScan.length
        ? `Missing scan tools: ${missingScan.map((t) => t.name).join(", ")}`
        : "Core scan tools installed",
      level: missingScan.length >= 3 ? "fail" : missingScan.length ? "warn" : "ok",
      detail: missingScan.length
        ? "Jobs using these tools fail instead of finding bugs. Install them on the runner."
        : "nuclei, httpx, nmap, gobuster, nikto and sslscan are all present.",
      fixHref: missingScan.length ? "/dashboard/runners" : undefined,
      fixLabel: missingScan.length ? "Install tools" : undefined,
    });

    // 4. Exploit/validation tools.
    const missingExp = EXPLOIT_TOOLS.filter((t) => !installed.has(t.id));
    checks.push({
      id: "exploit-tools",
      label: missingExp.length
        ? `Missing validation tools: ${missingExp.map((t) => t.name).join(", ")}`
        : "Exploit/validation tools installed",
      level: missingExp.length >= 3 ? "warn" : missingExp.length ? "warn" : "ok",
      detail: missingExp.length
        ? "Without these the exploit stage can't confirm issues (searchsploit/sqlmap/wpscan/metasploit)."
        : "searchsploit, sqlmap, wpscan and metasploit are present.",
      fixHref: missingExp.length ? "/dashboard/runners" : undefined,
      fixLabel: missingExp.length ? "Install tools" : undefined,
    });
  }

  // 5. Authorization.
  checks.push({
    id: "auth",
    label: eng.authorized ? "Authorization recorded" : "Not authorized",
    level: eng.authorized ? "ok" : "fail",
    detail: eng.authorized
      ? "Scanning and exploitation are unlocked for this engagement."
      : "Scan/exploit are blocked until you record written authorization above.",
  });

  // 6. Scannable scope.
  const targets = parseScopeTargets(eng.scope);
  checks.push({
    id: "scope",
    label: targets.length ? `${targets.length} scannable target(s) in scope` : "No scannable targets in scope",
    level: targets.length ? "ok" : "fail",
    detail: targets.length
      ? `Targets: ${targets.slice(0, 6).join(", ")}${targets.length > 6 ? "…" : ""}`
      : "Add in-scope hosts/URLs to the engagement scope (one per line) so the engine has something to scan.",
    fixHref: targets.length ? undefined : `/dashboard/engagements/${eng.id}/edit`,
    fixLabel: targets.length ? undefined : "Edit scope",
  });

  // 7. Recent failures — surface the real error so the cause is obvious.
  if (failed.length > 0) {
    const last = failed[0];
    const snippet = (last.output || "").split("\n").map((l) => l.trim()).filter(Boolean).slice(-2).join(" ").slice(0, 180);
    checks.push({
      id: "failures",
      label: `${failed.length} recent job failure(s)`,
      level: "warn",
      detail:
        `Most recent: ${last.tool} on ${last.target}. ` +
        (snippet ? `Output: "${snippet}"` : "Open the job to see the error.") +
        (/not found|no such file|command not|not installed/i.test(last.output || "")
          ? " — looks like the tool isn't installed."
          : ""),
      fixHref: `/dashboard/jobs?engagement=${eng.id}`,
      fixLabel: "View jobs",
    });
  } else if (total === 0) {
    checks.push({
      id: "nojobs",
      label: "No scans run yet",
      level: "warn",
      detail: "Use the command center (Scan & recon) or the assessment pipeline to start finding bugs.",
    });
  }

  const missingTools = REQUIRED_TOOL_IDS.filter((id) => !installed.has(id));

  return {
    checks,
    okCount: checks.filter((c) => c.level === "ok").length,
    failCount: checks.filter((c) => c.level === "fail").length,
    warnCount: checks.filter((c) => c.level === "warn").length,
    canInstall: online.length > 0 && missingTools.length > 0,
    missingTools,
  };
}
