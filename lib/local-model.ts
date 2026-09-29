"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { pickRunnerId } from "@/lib/pipeline-engine";
import { JOB_PRIORITY } from "@/lib/runner-constants";
import { parseScopeTargets } from "@/lib/bugbounty-core";
import { logAudit } from "@/lib/audit";

/**
 * Queue an OPTIONAL local-model reasoning pass ("llmreason") on a target — the
 * runner asks an on-machine Ollama model (free, no API) for testable hypotheses
 * from the target's dossier. Owner-gated. The result comes back as the job output
 * and is shown on the engagement's Leads tab.
 */
export async function askLocalModel(formData: FormData) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/login");
  const engagementId = String(formData.get("engagementId") ?? "");
  const back = `/dashboard/engagements/${engagementId}`;
  if (!engagementId) redirect("/dashboard/engagements");

  const eng = await prisma.engagement.findUnique({
    where: { id: engagementId },
    select: { ownerEmail: true, scope: true },
  });
  if (!eng) redirect("/dashboard/engagements");
  if (eng.ownerEmail && eng.ownerEmail !== email) {
    redirect(`${back}?error=${encodeURIComponent("Only the engagement owner can run this.")}`);
  }
  const host = String(formData.get("host") ?? "").trim();
  const target = host || parseScopeTargets(eng!.scope)[0] || "";
  if (!target) {
    redirect(`${back}?error=${encodeURIComponent("No target host in scope to reason about.")}`);
  }
  const runnerId = await pickRunnerId();
  if (!runnerId) {
    redirect(`${back}?error=${encodeURIComponent("No runner online — connect a machine first.")}`);
  }

  await prisma.job.create({
    data: {
      engagementId,
      runnerId: runnerId!,
      tool: "llmreason",
      target: target!,
      args: "",
      autoImport: false, // advisory reasoning — not a finding
      queuedBy: `llmreason:${email}`,
      priority: JOB_PRIORITY.manual,
    },
  });
  await logAudit({ type: "engine.llmreason", actor: email, summary: `Asked the local model on ${target}`, target: engagementId });
  redirect(`${back}?ok=${encodeURIComponent(`Asked the local model on ${target} — its hypotheses appear on the Leads tab shortly (needs Ollama running on the machine).`)}`);
}
