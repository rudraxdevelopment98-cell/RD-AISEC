"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { parseScopeTargets } from "@/lib/bugbounty-core";
import { queueHostScans, queueExploitJobs } from "@/lib/bug-pipeline";
import {
  startPipeline,
  approveCurrentStage,
  rerunStage,
  setPipelineStatus,
  setPipelineAutoApprove,
  recheckPipeline,
  runTriage,
  pickRunnerId,
} from "@/lib/pipeline-engine";
import { STAGE_ORDER } from "@/lib/pipeline-core";

async function requireUser() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/login");
  return email;
}

function back(id: string, q: string) {
  return `/dashboard/engagements/${id}?${q}`;
}

/** Launch the guided, approval-gated assessment pipeline for an engagement. */
export async function startAssessment(formData: FormData) {
  const email = await requireUser();
  const id = String(formData.get("engagementId") ?? "");
  const autoApprove = formData.get("autoApprove") === "on";
  const deep = formData.get("deep") === "on";
  const eng = await prisma.engagement.findUnique({ where: { id }, select: { authorized: true } });
  if (!eng) redirect("/dashboard/engagements");
  if (!eng!.authorized) redirect(back(id, "error=" + encodeURIComponent("Record written authorization first.")));
  let runnerId = String(formData.get("runnerId") ?? "");
  if (!runnerId) runnerId = await pickRunnerId();
  if (!runnerId) redirect(back(id, "error=" + encodeURIComponent("Register a runner machine first.")));
  await startPipeline(id, runnerId, autoApprove, email, deep);
  revalidatePath(`/dashboard/engagements/${id}`);
  redirect(back(id, "ok=" + encodeURIComponent(deep ? "Deep assessment started" : "Assessment started")));
}

/** Approve the current stage and advance to the next. */
export async function approveStage(formData: FormData) {
  await requireUser();
  const id = String(formData.get("engagementId") ?? "");
  await approveCurrentStage(id);
  revalidatePath(`/dashboard/engagements/${id}`);
  redirect(back(id, "ok=" + encodeURIComponent("Stage approved — moving on")));
}

export async function pauseAssessment(formData: FormData) {
  await requireUser();
  const id = String(formData.get("engagementId") ?? "");
  await setPipelineStatus(id, "paused");
  revalidatePath(`/dashboard/engagements/${id}`);
}

export async function resumeAssessment(formData: FormData) {
  await requireUser();
  const id = String(formData.get("engagementId") ?? "");
  await setPipelineStatus(id, "running");
  await recheckPipeline(id);
  revalidatePath(`/dashboard/engagements/${id}`);
}

export async function cancelAssessment(formData: FormData) {
  await requireUser();
  const id = String(formData.get("engagementId") ?? "");
  await setPipelineStatus(id, "canceled");
  revalidatePath(`/dashboard/engagements/${id}`);
}

export async function toggleAutoApprove(formData: FormData) {
  await requireUser();
  const id = String(formData.get("engagementId") ?? "");
  const on = String(formData.get("autoApprove") ?? "") === "true";
  await setPipelineAutoApprove(id, on);
  revalidatePath(`/dashboard/engagements/${id}`);
}

// ── Command-center one-click actions (standalone, auto-flowing) ───────────────

async function readyRunner(id: string): Promise<string> {
  const eng = await prisma.engagement.findUnique({ where: { id }, select: { authorized: true } });
  if (!eng) redirect("/dashboard/engagements");
  if (!eng!.authorized) redirect(back(id, "error=" + encodeURIComponent("Record written authorization first.")));
  const runnerId = await pickRunnerId();
  if (!runnerId) redirect(back(id, "error=" + encodeURIComponent("Register a runner machine first.")));
  return runnerId;
}

/** Scan & recon now: queue the full recon+scan pipeline on the scope. */
export async function runScanNow(formData: FormData) {
  const email = await requireUser();
  const id = String(formData.get("engagementId") ?? "");
  const runnerId = await readyRunner(id);
  const eng = await prisma.engagement.findUnique({ where: { id }, select: { scope: true } });
  const hosts = parseScopeTargets(eng?.scope ?? "");
  if (hosts.length === 0) redirect(back(id, "error=" + encodeURIComponent("No scannable targets in scope.")));
  const n = await queueHostScans(id, runnerId, hosts, email, 15);
  if (n === 0) redirect(back(id, "error=" + encodeURIComponent("Everything is already queued.")));
  redirect(`/dashboard/jobs?engagement=${id}`);
}

/** Deep scan now: heavier recon+scan (all ports + vuln scripts + nikto/sslscan). */
export async function runDeepScanNow(formData: FormData) {
  const email = await requireUser();
  const id = String(formData.get("engagementId") ?? "");
  const runnerId = await readyRunner(id);
  const eng = await prisma.engagement.findUnique({ where: { id }, select: { scope: true } });
  const hosts = parseScopeTargets(eng?.scope ?? "");
  if (hosts.length === 0) redirect(back(id, "error=" + encodeURIComponent("No scannable targets in scope.")));
  const n = await queueHostScans(id, runnerId, hosts, email, 15, true);
  if (n === 0) redirect(back(id, "error=" + encodeURIComponent("Everything is already queued.")));
  redirect(`/dashboard/jobs?engagement=${id}`);
}

/** Re-run a single pipeline stage with deep settings (escalate one stage). */
export async function rerunStageDeep(formData: FormData) {
  await requireUser();
  const id = String(formData.get("engagementId") ?? "");
  const stage = String(formData.get("stage") ?? "");
  if (!STAGE_ORDER.includes(stage)) redirect(back(id, "error=" + encodeURIComponent("Unknown stage.")));
  await rerunStage(id, stage, true);
  revalidatePath(`/dashboard/engagements/${id}`);
  redirect(back(id, "ok=" + encodeURIComponent(`Re-running ${stage} (deep)`)));
}

/** Exploit & validate now: queue exploit-validation jobs from current findings. */
export async function runExploitNow(formData: FormData) {
  const email = await requireUser();
  const id = String(formData.get("engagementId") ?? "");
  const runnerId = await readyRunner(id);
  const findings = await prisma.finding.findMany({
    where: { engagementId: id },
    select: { title: true, description: true, severity: true, owasp: true },
  });
  const n = await queueExploitJobs(id, runnerId, findings, email);
  if (n === 0) redirect(back(id, "error=" + encodeURIComponent("No exploit actions found yet — scan first.")));
  redirect(`/dashboard/jobs?engagement=${id}`);
}

/** Triage now: fill remediation guidance on findings that lack it. */
export async function runTriageNow(formData: FormData) {
  await requireUser();
  const id = String(formData.get("engagementId") ?? "");
  const summary = await runTriage(id);
  revalidatePath(`/dashboard/engagements/${id}`);
  redirect(back(id, "ok=" + encodeURIComponent(summary)) + "#findings");
}
