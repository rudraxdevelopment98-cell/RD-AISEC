"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { pickRunnerId } from "@/lib/pipeline-engine";
import { normalizeTarget, validateTarget, JOB_PRIORITY } from "@/lib/runner-constants";

/**
 * Autoscan a target from anywhere (the global floating launcher). Queues a small,
 * sensible scan on a runner: nmap service+vuln for a bare IP, or httpx + nuclei
 * for a host/URL. Auto-imports findings when an engagement is chosen. Only
 * allowlisted tools with validated targets are queued.
 */
export async function launchAutoscan(formData: FormData) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/login");

  const rawTarget = String(formData.get("target") ?? "").trim();
  const engagementId = String(formData.get("engagementId") ?? "") || null;
  const back = String(formData.get("back") ?? "/dashboard/jobs");
  if (!rawTarget) {
    redirect(`${back}?error=${encodeURIComponent("Enter a target host or URL to autoscan.")}`);
  }
  const runnerId = String(formData.get("runnerId") ?? "") || (await pickRunnerId());
  if (!runnerId) {
    redirect(`${back}?error=${encodeURIComponent("No runner online — connect a machine first.")}`);
  }

  const bareHost = rawTarget.replace(/^[a-z]+:\/\//i, "").split("/")[0];
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(bareHost);
  // A URL target gets a scheme so the URL-based tools accept it.
  const urlTarget = /^[a-z]+:\/\//i.test(rawTarget) ? rawTarget : `https://${rawTarget}`;

  const recipe: { tool: string; target: string; args: string }[] = isIp
    ? [{ tool: "nmap", target: bareHost, args: "-Pn -sV -T4 --host-timeout 20m" }]
    : [
        { tool: "httpx", target: urlTarget, args: "-title -status-code -tech-detect" },
        {
          tool: "nuclei",
          target: urlTarget,
          args: "-tags cve,exposure,misconfig -severity medium,high,critical -jsonl -rl 150 -timeout 8 -retries 1",
        },
      ];

  const data = recipe
    .map((j) => ({ ...j, target: normalizeTarget(j.tool, j.target) }))
    .filter((j) => validateTarget(j.tool, j.target))
    .map((j) => ({
      runnerId,
      tool: j.tool,
      target: j.target,
      args: j.args,
      autoImport: !!engagementId,
      engagementId: engagementId ?? undefined,
      queuedBy: email,
      priority: JOB_PRIORITY.normal,
    }));

  if (data.length === 0) {
    redirect(`${back}?error=${encodeURIComponent("Couldn't build a scan for that target — check it's a valid host/URL.")}`);
  }
  await prisma.job.createMany({ data });
  redirect(`/dashboard/jobs?queued=1`);
}
