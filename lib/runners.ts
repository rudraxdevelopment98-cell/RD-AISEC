"use server";

import { createHash, randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  findTool,
  isSafeValue,
  normalizeTarget,
  validateTarget,
  INSTALLABLE_PKGS,
} from "@/lib/runner-constants";
import { parseJobFindings } from "@/lib/job-parser";
import { tagFindings } from "@/lib/finding-map";

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

/**
 * Request installing a missing tool on a runner. Requires explicit authorization
 * ("proof") — the user must confirm they may install software on that machine.
 * Only known, allowlisted packages (INSTALLABLE_PKGS) can be requested; the
 * runner runs apt for that package only — never an arbitrary command.
 */
export async function requestInstall(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const runnerId = String(formData.get("runnerId") ?? "");
  const tool = String(formData.get("tool") ?? "");
  const confirmed = String(formData.get("confirm") ?? "") === "true";

  if (!confirmed) {
    redirect(
      `/dashboard/runners?error=${encodeURIComponent(
        "Tick the authorization box — installing software on a machine needs your confirmation.",
      )}`,
    );
  }
  if (!runnerId || !INSTALLABLE_PKGS[tool]) {
    redirect(`/dashboard/runners?error=${encodeURIComponent("That tool can't be installed from here.")}`);
  }

  // Avoid duplicate pending/installing requests for the same tool.
  const existing = await prisma.install.findFirst({
    where: { runnerId, tool, status: { in: ["pending", "installing"] } },
  });
  if (!existing) {
    await prisma.install.create({
      data: { runnerId, tool, requestedBy: session.user.email ?? "" },
    });
  }
  revalidatePath("/dashboard/runners");
}

export async function deleteRunner(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.runner.delete({ where: { id } }).catch(() => {});
  revalidatePath("/dashboard/runners");
}

/**
 * Toggle Tor anonymity for a runner. The runner reads this on its next poll and
 * routes its tool traffic through Tor (torsocks). Clears the reported exit IP
 * when turning off.
 */
export async function setRunnerAnonymity(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const on = String(formData.get("on") ?? "") === "true";
  if (id) {
    await prisma.runner
      .update({
        where: { id },
        data: { anonymity: on, ...(on ? {} : { exitIp: "" }) },
      })
      .catch(() => {});
  }
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

  const back = "/dashboard/jobs";

  if (!engagementId || !runnerId || !toolId || !target) {
    redirect(`${back}?error=${encodeURIComponent("All fields are required.")}`);
  }

  const tool = findTool(toolId);
  const preset = tool?.presets.find((p) => p.id === presetId) ?? tool?.presets[0];
  if (!tool || !preset) {
    redirect(`${back}?error=${encodeURIComponent("Unknown tool or preset.")}`);
  }

  // Normalize per tool: nmap/whois/dig get a bare host (no scheme/path); httpx/
  // nuclei keep the full URL.
  const finalTarget = normalizeTarget(tool!.id, target);

  if (!validateTarget(tool!.id, finalTarget)) {
    redirect(
      `${back}?error=${encodeURIComponent("Target contains characters that aren't allowed.")}`,
    );
  }

  const engagement = await prisma.engagement.findUnique({
    where: { id: engagementId },
    select: { authorized: true, scope: true },
  });
  if (!engagement) redirect(`${back}?error=${encodeURIComponent("Engagement not found.")}`);
  if (!engagement!.authorized) {
    redirect(
      `${back}?error=${encodeURIComponent(
        "This engagement is not marked authorized. Authorize it before running tools.",
      )}`,
    );
  }

  // Soft scope gate: if a scope is recorded, the target host must appear in it.
  const scope = (engagement!.scope ?? "").toLowerCase();
  const host = targetHost(finalTarget);
  if (scope.trim() && host && !scope.includes(host)) {
    redirect(
      `${back}?error=${encodeURIComponent(
        `"${host}" is not in this engagement's scope. Add it to the scope first.`,
      )}`,
    );
  }

  // Re-validate every preset arg token too (defense in depth).
  if (!preset!.args.every((a) => isSafeValue(a))) {
    redirect(`${back}?error=${encodeURIComponent("Preset arguments failed validation.")}`);
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

  revalidatePath("/dashboard/jobs");
  redirect(back);
}

/**
 * Queue a CUSTOM command on a runner — runs an arbitrary command line on YOUR
 * own authorized machine. The portal never executes it; only the runner does,
 * via argv (shlex-split, no shell), so there's no shell-injection surface.
 * Gated on an explicit authorization confirmation. Engagement is optional.
 */
export async function queueCustomJob(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const runnerId = String(formData.get("runnerId") ?? "");
  const engagementId = String(formData.get("engagementId") ?? "");
  const command = String(formData.get("command") ?? "").trim();
  const confirmed = String(formData.get("confirm") ?? "") === "true";
  const back = String(formData.get("back") ?? "/dashboard/jobs");

  if (!runnerId || !command) {
    redirect(`${back}?error=${encodeURIComponent("Pick a machine and enter a command.")}`);
  }
  if (!confirmed) {
    redirect(
      `${back}?error=${encodeURIComponent(
        "Confirm you're authorized to run this command on this machine.",
      )}`,
    );
  }
  if (command.length > 1024) {
    redirect(`${back}?error=${encodeURIComponent("Command is too long (max 1024 chars).")}`);
  }
  // Printable single-line ASCII only — no newlines or control characters. Shell
  // metacharacters ARE allowed (the runner uses argv via shlex, never a shell).
  if (!/^[\x20-\x7e]+$/.test(command)) {
    redirect(
      `${back}?error=${encodeURIComponent("Command has newlines or non-printable characters.")}`,
    );
  }

  // If filing under an engagement, it must be authorized.
  if (engagementId) {
    const engagement = await prisma.engagement.findUnique({
      where: { id: engagementId },
      select: { authorized: true },
    });
    if (!engagement) redirect(`${back}?error=${encodeURIComponent("Engagement not found.")}`);
    if (!engagement!.authorized) {
      redirect(
        `${back}?error=${encodeURIComponent("Authorize the engagement before running commands.")}`,
      );
    }
  }

  const program = command.split(/\s+/)[0].slice(0, 80);
  await prisma.job.create({
    data: {
      engagementId: engagementId || null,
      runnerId,
      tool: "custom",
      target: program, // shown as a label; the runner reads `args`
      args: command,
      queuedBy: session.user.email ?? "",
    },
  });

  revalidatePath("/dashboard/jobs");
  redirect(`${back}?queued=1`);
}

// nmap presets for the runner's own LAN (no free-form target — the CIDR comes
// from what the runner detected, so the scope substring check is skipped).
// Deeper modes (service/aggressive/vuln) are real scans — slower, and OS/script
// detection needs the runner to run as root.
const LOCAL_SCAN_PRESETS: Record<string, string[]> = {
  discovery: ["-sn", "-T4"], // live hosts only (ping sweep)
  network: ["-Pn", "-T4", "--top-ports", "100"], // top 100 ports
  full: ["-Pn", "-T4", "-p-"], // all 65535 TCP ports
  service: ["-Pn", "-T4", "-sV", "--top-ports", "200"], // service + version
  aggressive: ["-Pn", "-T4", "-A"], // OS + version + scripts + traceroute (root)
  vuln: ["-Pn", "-T4", "-sV", "--script", "vuln"], // vuln NSE scripts (root)
};

/**
 * Queue an nmap scan of one of the runner's OWN detected subnets. The target is
 * validated against the runner's reported subnets (not user free-form), so this
 * stays "scan the network this machine is on" — its own infrastructure.
 */
export async function queueLocalScan(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // engagementId is OPTIONAL — empty means a "quick scan" (no engagement).
  const engagementId = String(formData.get("engagementId") ?? "");
  const runnerId = String(formData.get("runnerId") ?? "");
  const subnet = String(formData.get("subnet") ?? "").trim();
  const mode = String(formData.get("mode") ?? "discovery");
  const back = "/dashboard/network";

  if (!runnerId || !subnet) {
    redirect(`${back}?error=${encodeURIComponent("Pick a runner and a network.")}`);
  }

  const runner = await prisma.runner.findUnique({ where: { id: runnerId } });
  const reported = (runner?.subnets ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!runner || !reported.includes(subnet)) {
    redirect(`${back}?error=${encodeURIComponent("That network isn't one this runner detected.")}`);
  }

  // If filing under an engagement, it must be authorized. Quick scans skip this.
  if (engagementId) {
    const engagement = await prisma.engagement.findUnique({
      where: { id: engagementId },
      select: { authorized: true },
    });
    if (!engagement) redirect(`${back}?error=${encodeURIComponent("Engagement not found.")}`);
    if (!engagement!.authorized) {
      redirect(`${back}?error=${encodeURIComponent("Authorize the engagement before scanning.")}`);
    }
  }

  const args = LOCAL_SCAN_PRESETS[mode] ?? LOCAL_SCAN_PRESETS.discovery;
  await prisma.job.create({
    data: {
      engagementId: engagementId || null,
      runnerId,
      tool: "nmap",
      target: subnet,
      args: args.join(" "),
      queuedBy: session.user.email ?? "",
    },
  });

  revalidatePath("/dashboard/network");
  revalidatePath("/dashboard/runners");
  redirect(`${back}?queued=1`);
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

/** Re-queue a job (same tool/target/args/runner) — e.g. after installing a tool. */
export async function retryJob(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const job = await prisma.job.findUnique({ where: { id } });
  if (job) {
    await prisma.job.create({
      data: {
        engagementId: job.engagementId,
        runnerId: job.runnerId,
        tool: job.tool,
        target: job.target,
        args: job.args,
        queuedBy: session.user.email ?? "",
      },
    });
  }
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
  if (!job || job.status !== "done" || !job.engagementId) {
    // Quick scans (no engagement) have nowhere to import findings to.
    revalidatePath("/dashboard/runners");
    return;
  }

  const engagementId = job.engagementId; // narrowed: not null past the guard above
  const findings = tagFindings(
    parseJobFindings(job.tool, job.target, job.output),
    job.tool,
  );
  if (findings.length > 0) {
    await prisma.finding.createMany({
      data: findings.map((f) => ({ ...f, engagementId })),
    });
    await prisma.engagement.update({
      where: { id: engagementId },
      data: { updatedAt: new Date() },
    });
  }

  revalidatePath("/dashboard/runners");
  redirect(`/dashboard/engagements/${engagementId}`);
}
