"use server";

import { createHash, randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { findTool, isSafeValue, normalizeTarget, validateTarget } from "@/lib/runner-constants";
import { parseJobFindings } from "@/lib/job-parser";

/** Hash a runner token for storage/lookup (never store the plaintext). */
export async function hashToken(token: string): Promise<string> {
  return createHash("sha256").update(token).digest("hex");
}

/** Pull the host out of a target so we can check it against engagement scope. */
function targetHost(target: string): string {
  let t = target.trim().toLowerCase();
  t = t.replace(/^[a-z]+:\/\//, ""); // strip scheme
  t = t.split("/")[0]; // strip path
  t = t.split(":")[0]; // strip port
  return t;
}

type CreateRunnerState = { token?: string; name?: string; error?: string };

/**
 * Create a runner and return its token ONCE (for useActionState). The plaintext
 * token is shown to the user a single time; only its hash is stored.
 */
export async function createRunner(
  _prev: CreateRunnerState,
  formData: FormData,
): Promise<CreateRunnerState> {
  const session = await auth();
  if (!session?.user) return { error: "Not signed in." };

  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return { error: "Give the runner a name." };

  const token = "rdr_" + randomBytes(24).toString("hex");
  await prisma.runner.create({
    data: {
      name,
      tokenHash: await hashToken(token),
      ownerEmail: session.user.email ?? "",
    },
  });

  revalidatePath("/dashboard/runners");
  return { token, name };
}

export async function deleteRunner(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.runner.delete({ where: { id } }).catch(() => {});
  revalidatePath("/dashboard/runners");
}

/**
 * Queue a tool execution for a runner to pick up.
 * Guardrails: engagement must be authorized; tool + preset must be allowlisted;
 * target must be in scope and contain no shell metacharacters.
 */
export async function queueJob(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const engagementId = String(formData.get("engagementId") ?? "");
  const runnerId = String(formData.get("runnerId") ?? "");
  const toolId = String(formData.get("tool") ?? "");
  const presetId = String(formData.get("preset") ?? "");
  const target = String(formData.get("target") ?? "").trim().slice(0, 512);

  const back = engagementId
    ? `/dashboard/runners?engagement=${engagementId}`
    : "/dashboard/runners";

  if (!engagementId || !runnerId || !toolId || !target) {
    redirect(`${back}&error=${encodeURIComponent("All fields are required.")}`);
  }

  const tool = findTool(toolId);
  const preset = tool?.presets.find((p) => p.id === presetId) ?? tool?.presets[0];
  if (!tool || !preset) {
    redirect(`${back}&error=${encodeURIComponent("Unknown tool or preset.")}`);
  }

  // Normalize per tool: nmap/whois/dig get a bare host (no scheme/path); httpx/
  // nuclei keep the full URL.
  const finalTarget = normalizeTarget(tool!.id, target);

  if (!validateTarget(tool!.id, finalTarget)) {
    redirect(
      `${back}&error=${encodeURIComponent("Target contains characters that aren't allowed.")}`,
    );
  }

  const engagement = await prisma.engagement.findUnique({
    where: { id: engagementId },
    select: { authorized: true, scope: true },
  });
  if (!engagement) redirect(`${back}&error=${encodeURIComponent("Engagement not found.")}`);
  if (!engagement!.authorized) {
    redirect(
      `${back}&error=${encodeURIComponent(
        "This engagement is not marked authorized. Authorize it before running tools.",
      )}`,
    );
  }

  // Soft scope gate: if a scope is recorded, the target host must appear in it.
  const scope = (engagement!.scope ?? "").toLowerCase();
  const host = targetHost(finalTarget);
  if (scope.trim() && host && !scope.includes(host)) {
    redirect(
      `${back}&error=${encodeURIComponent(
        `"${host}" is not in this engagement's scope. Add it to the scope first.`,
      )}`,
    );
  }

  // Re-validate every preset arg token too (defense in depth).
  if (!preset!.args.every((a) => isSafeValue(a))) {
    redirect(`${back}&error=${encodeURIComponent("Preset arguments failed validation.")}`);
  }

  await prisma.job.create({
    data: {
      engagementId,
      runnerId,
      tool: tool!.id,
      target: finalTarget,
      args: preset!.args.join(" "),
      queuedBy: session.user.email ?? "",
    },
  });

  revalidatePath("/dashboard/runners");
  redirect(back);
}

export async function cancelJob(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  if (id) {
    await prisma.job
      .updateMany({
        where: { id, status: { in: ["queued", "running"] } },
        data: { status: "canceled", finishedAt: new Date() },
      })
      .catch(() => {});
  }
  revalidatePath("/dashboard/runners");
}

export async function deleteJob(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.job.delete({ where: { id } }).catch(() => {});
  revalidatePath("/dashboard/runners");
}

/**
 * Turn a completed job's output into findings on its engagement.
 * Parsing is per-tool and best-effort (see lib/job-parser).
 */
export async function importJobFindings(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const id = String(formData.get("id") ?? "");
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job || job.status !== "done") {
    revalidatePath("/dashboard/runners");
    return;
  }

  const findings = parseJobFindings(job.tool, job.target, job.output);
  if (findings.length > 0) {
    await prisma.finding.createMany({
      data: findings.map((f) => ({ ...f, engagementId: job.engagementId })),
    });
    await prisma.engagement.update({
      where: { id: job.engagementId },
      data: { updatedAt: new Date() },
    });
  }

  revalidatePath("/dashboard/runners");
  redirect(`/dashboard/engagements/${job.engagementId}`);
}
