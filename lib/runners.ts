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
  isInstallable,
  installableTools,
  RUNNER_ONLINE_WINDOW_MS,
} from "@/lib/runner-constants";
import { hashToken } from "@/lib/runner-auth";
import { assertRunnerOwner, isUnlocked } from "@/lib/control";
import { parseScopeTargets } from "@/lib/bugbounty-core";
import { parseJobFindings } from "@/lib/job-parser";
import { gateFindings } from "@/lib/finding-gate";
import { loadRules, recordSuppressions } from "@/lib/suppression";
import { filterSuppressed } from "@/lib/suppression-core";
import { dedupFindings } from "@/lib/dedup-core";
import { enrichFindingsIntel } from "@/lib/engine/finding-intel";
import { logAudit } from "@/lib/audit";
import { tagFindings } from "@/lib/finding-map";
import { REQUIRED_TOOL_IDS } from "@/lib/diagnostics";

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
      tokenHash: hashToken(token),
      ownerEmail: session.user.email ?? "",
    },
  });

  revalidatePath("/dashboard/runners");
  return { token, name };
}

type EnrollState = { code?: string; error?: string; expiresAt?: string };

/**
 * Mint a reusable enrollment code (shown ONCE) that a machine uses to self-register
 * for a runner token — so token loss/rotation no longer means SSHing in to edit
 * systemd. Owner-scoped, expiring, revocable; only its hash is stored.
 */
export async function createEnrollCode(
  _prev: EnrollState,
  formData: FormData,
): Promise<EnrollState> {
  const session = await auth();
  if (!session?.user?.email) return { error: "Not signed in." };

  const label = String(formData.get("label") ?? "").trim().slice(0, 80);
  const days = Math.min(365, Math.max(1, Number(formData.get("days") ?? 90) || 90));
  const code = "rde_" + randomBytes(18).toString("hex");
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  await prisma.enrollCode.create({
    data: {
      codeHash: createHash("sha256").update(code).digest("hex"),
      ownerEmail: session.user.email,
      label,
      expiresAt,
    },
  });
  await logAudit({ type: "enroll_code.create", actor: session.user.email,
    summary: `Created a runner enrollment code${label ? ` (${label})` : ""}`, meta: { days } });
  revalidatePath("/dashboard/runners");
  return { code, expiresAt: expiresAt.toISOString() };
}

/** Revoke an enrollment code so no further machines can enroll with it. */
export async function revokeEnrollCode(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.enrollCode.updateMany({
    where: { id, ownerEmail: session.user.email },
    data: { revoked: true },
  });
  revalidatePath("/dashboard/runners");
}

/**
 * Request installing a missing tool on a runner. Requires explicit authorization
 * ("proof") — the user must confirm they may install software on that machine.
 * Only known, allowlisted tools (isInstallable) can be requested; the runner
 * installs that tool via apt or its fixed alt method (e.g. `go install` for
 * httpx) — never an arbitrary command.
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
  if (!runnerId || !isInstallable(tool)) {
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

/**
 * One-click: queue installs for EVERY installable tool this machine is missing,
 * so the operator doesn't have to add them one at a time. Recomputes the missing
 * set server-side from what the runner reports present; skips anything already
 * queued/installing. Only allowlisted packages are ever requested.
 */
export async function installAllTools(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const runnerId = String(formData.get("runnerId") ?? "");
  const back = String(formData.get("back") ?? "/dashboard/runners");
  if (!runnerId) redirect(`${back}?error=${encodeURIComponent("No machine specified.")}`);

  const runner = await prisma.runner.findUnique({
    where: { id: runnerId },
    select: { installed: true, installs: { where: { status: { in: ["pending", "installing"] } }, select: { tool: true } } },
  });
  if (!runner) redirect(`${back}?error=${encodeURIComponent("Machine not found.")}`);

  const have = new Set((runner.installed || "").split(",").map((s) => s.trim()).filter(Boolean));
  const pending = new Set(runner.installs.map((i) => i.tool));
  const toQueue = installableTools().filter((t) => !have.has(t) && !pending.has(t));

  for (const tool of toQueue) {
    await prisma.install.create({ data: { runnerId, tool, requestedBy: session.user.email ?? "" } });
  }

  revalidatePath("/dashboard/runners");
  revalidatePath(back);
  redirect(
    `${back}?ok=${encodeURIComponent(
      toQueue.length > 0
        ? `Queued ${toQueue.length} tool install(s) — watch progress here`
        : "Nothing to install — all tools present or already queued",
    )}`,
  );
}

/**
 * One-click: install every required scan/exploit tool that's missing on the
 * online runner(s). Recomputes the missing set server-side; only allowlisted
 * apt packages are ever requested. Returns the user to the engagement.
 */
export async function installRequiredTools(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const engagementId = String(formData.get("engagementId") ?? "");
  const backTo = engagementId ? `/dashboard/engagements/${engagementId}` : "/dashboard/runners";

  const now = Date.now();
  const runners = await prisma.runner.findMany({
    select: { id: true, lastSeenAt: true, installed: true },
  });
  const online = runners.filter(
    (r) => r.lastSeenAt && now - new Date(r.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS,
  );
  if (online.length === 0) {
    redirect(`${backTo}?error=${encodeURIComponent("No runner online to install on.")}`);
  }

  let queued = 0;
  for (const r of online) {
    const have = new Set((r.installed || "").split(",").map((s) => s.trim()).filter(Boolean));
    for (const tool of REQUIRED_TOOL_IDS) {
      if (have.has(tool) || !isInstallable(tool)) continue;
      const existing = await prisma.install.findFirst({
        where: { runnerId: r.id, tool, status: { in: ["pending", "installing"] } },
      });
      if (!existing) {
        await prisma.install.create({
          data: { runnerId: r.id, tool, requestedBy: session.user.email ?? "" },
        });
        queued += 1;
      }
    }
  }
  revalidatePath("/dashboard/runners");
  revalidatePath(backTo);
  redirect(
    `${backTo}?ok=${encodeURIComponent(
      queued > 0 ? `Queued ${queued} tool install(s) — watch progress on Machines` : "Nothing to install — tools already present or queued",
    )}`,
  );
}

export async function deleteRunner(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  if (id) {
    // Cancel its outstanding jobs first — otherwise onDelete:SetNull orphans them
    // (runnerId becomes null and no runner can ever claim them → stuck forever).
    await prisma.job
      .updateMany({
        where: { runnerId: id, status: { in: ["queued", "running"] } },
        data: { status: "canceled", finishedAt: new Date() },
      })
      .catch(() => {});
    await prisma.runner.delete({ where: { id } }).catch(() => {});
  }
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
 * Set how many jobs a machine runs in parallel. The runner reads this on its
 * next poll (X-Runner-Max-Workers) and adjusts live — no restart needed.
 * Clamped 1..16 so a typo can't spawn hundreds of concurrent tools.
 */
export async function restartRunner(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  if (id) {
    await prisma.runner.update({ where: { id }, data: { restartRequested: true } });
  }
  revalidatePath(`/dashboard/runners/${id}`);
  redirect(
    `/dashboard/runners/${id}?ok=${encodeURIComponent(
      "Restart requested — the machine restarts on its next check-in (a few seconds) and updates to the latest version.",
    )}`,
  );
}

export async function setRunnerWorkers(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const n = Math.min(16, Math.max(1, parseInt(String(formData.get("workers") ?? ""), 10) || 1));
  if (id) {
    await prisma.runner.update({ where: { id }, data: { maxWorkers: n } });
  }
  revalidatePath("/dashboard/runners");
}

/**
 * Set a machine's daily self-heal / maintenance schedule. The runner reads the
 * new window on its next poll (X-Runner-Maint-*) and applies it live — no restart
 * needed. Hours are 0–23 local to the machine; the window may wrap past midnight.
 */
export async function setRunnerMaintenance(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const enabled = formData.get("enabled") != null;
  const hour = (key: string, dflt: number) => {
    const n = parseInt(String(formData.get(key) ?? ""), 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(23, n)) : dflt;
  };
  const back = String(formData.get("back") ?? "/dashboard/runners");
  if (id) {
    await prisma.runner.update({
      where: { id },
      data: {
        maintEnabled: enabled,
        maintStartHour: hour("startHour", 6),
        maintEndHour: hour("endHour", 8),
      },
    });
  }
  revalidatePath("/dashboard/runners");
  revalidatePath(back);
  redirect(back);
}

/** Rename a machine (owner-managed label; the token/identity is unchanged). */
export async function renameRunner(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  const back = String(formData.get("back") ?? "/dashboard/runners");
  if (id && name) {
    await prisma.runner.update({ where: { id }, data: { name } });
  }
  revalidatePath("/dashboard/runners");
  revalidatePath(back);
  redirect(back);
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

  // ffuf fuzzes wherever the FUZZ keyword is — without it the run fails instantly.
  if (tool!.id === "ffuf" && !finalTarget.includes("FUZZ")) {
    redirect(
      `${back}?error=${encodeURIComponent(
        "ffuf needs FUZZ in the target URL to mark where to fuzz, e.g. https://site/FUZZ.",
      )}`,
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

  // Scope gate: if a scope is recorded, the target host must match an in-scope
  // entry exactly OR be a subdomain of one (a host-boundary match, not a raw
  // substring — so scope "notexample.com" no longer admits "example.com", and
  // "ample.co" no longer sneaks in under "example.com").
  const scopeHosts = parseScopeTargets(engagement!.scope ?? "").map((h) => h.toLowerCase());
  const host = targetHost(finalTarget);
  const inScope = scopeHosts.some((e) => host === e || host.endsWith("." + e));
  if (scopeHosts.length > 0 && host && !inScope) {
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
      // "Run first" queues this above everything already waiting on the runner.
      priority: formData.get("priority") === "high" ? await nextTopPriority(runnerId) : 0,
    },
  });
  await logAudit({
    type: "job.queued",
    actor: session.user.email,
    summary: `Queued ${tool!.id} against ${finalTarget}`,
    target: finalTarget,
  });

  revalidatePath("/dashboard/jobs");
  redirect(back);
}

/**
 * Compute a priority that sits above every job currently queued for a runner, so
 * a "Run next" / "Run first" job is claimed before the rest of the queue. Capped
 * to keep the number sane. runnerId optional → considers the whole queue.
 */
async function nextTopPriority(runnerId?: string | null): Promise<number> {
  const top = await prisma.job.findFirst({
    where: { status: "queued", ...(runnerId ? { runnerId } : {}) },
    orderBy: { priority: "desc" },
    select: { priority: true },
  });
  return Math.min((top?.priority ?? 0) + 1, 1_000_000);
}

/** Bump a queued job above everything else waiting on its runner ("Run next"). */
export async function prioritizeJob(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  if (id) {
    const job = await prisma.job.findUnique({
      where: { id },
      select: { runnerId: true, status: true },
    });
    if (job && job.status === "queued") {
      const priority = await nextTopPriority(job.runnerId);
      await prisma.job
        .updateMany({ where: { id, status: "queued" }, data: { priority } })
        .catch(() => {});
    }
  }
  revalidatePath("/dashboard/jobs");
}

/** Reset a queued job back to normal priority (undo "Run next"). */
export async function deprioritizeJob(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  if (id) {
    await prisma.job
      .updateMany({ where: { id, status: "queued" }, data: { priority: 0 } })
      .catch(() => {});
  }
  revalidatePath("/dashboard/jobs");
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

  // A custom command is arbitrary code execution on the machine. It must be
  // owner-controlled AND behind an active full-control unlock — the SAME bar as
  // the interactive terminal — not merely "any signed-in member". This closes the
  // path where a member with no runner ownership could run commands (incl. sudo)
  // on someone else's machine, bypassing the PTY unlock gate.
  try {
    await assertRunnerOwner(runnerId);
  } catch {
    redirect(`${back}?error=${encodeURIComponent("You don't have control of this machine.")}`);
  }
  if (!(await isUnlocked(runnerId))) {
    redirect(
      `${back}?error=${encodeURIComponent(
        "Unlock full control on this machine (Machines → the machine → Full control) before running commands.",
      )}`,
    );
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
      // "Run first" queues this above everything already waiting on the runner.
      priority: formData.get("priority") === "high" ? await nextTopPriority(runnerId) : 0,
    },
  });
  await logAudit({
    type: "job.queued",
    actor: session.user.email,
    summary: `Ran custom command on a machine: ${program}`,
    target: runnerId,
    meta: { runnerId, command, engagementId: engagementId || null },
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

/** Bulk: archive selected jobs (only finished ones; running can't be archived). */
export async function archiveJobs(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (ids.length > 0) {
    await prisma.job.updateMany({
      where: { id: { in: ids }, status: { notIn: ["queued", "running"] } },
      data: { archived: true },
    });
  }
  revalidatePath("/dashboard/jobs");
}

/** Bulk: restore selected jobs from the archive. */
export async function unarchiveJobs(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (ids.length > 0) {
    await prisma.job.updateMany({ where: { id: { in: ids } }, data: { archived: false } });
  }
  revalidatePath("/dashboard/jobs");
}

/** Bulk: cancel every queued (not-yet-started) job. */
export async function cancelQueuedJobs() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  await prisma.job.updateMany({
    where: { status: "queued" },
    data: { status: "canceled", finishedAt: new Date() },
  });
  revalidatePath("/dashboard/jobs");
}

/** Bulk: permanently delete selected jobs. */
export async function deleteJobs(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (ids.length > 0) {
    await prisma.job.deleteMany({ where: { id: { in: ids } } });
  }
  revalidatePath("/dashboard/jobs");
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
  // Same accuracy gate as the auto-import path: drop patched/banner-only false
  // positives and de-confirm unvalidated matches before they become findings.
  let findings = gateFindings(
    tagFindings(parseJobFindings(job.tool, job.target, job.output), job.tool),
  ).kept;
  const host = job.target.replace(/^[a-z]+:\/\//i, "").split("/")[0].split(":")[0].toLowerCase();
  {
    const sup = filterSuppressed(findings, await loadRules(), { tool: job.tool, host });
    findings = sup.kept;
    if (sup.suppressed.length > 0) await recordSuppressions(sup.suppressed, {});
  }
  if (findings.length > 0) {
    // Signature de-dup + corroboration: a near-duplicate of an existing finding
    // (same vuln class + normalized title + host, from any tool) is merged in as
    // a corroborating source rather than creating a duplicate.
    const existing = await prisma.finding.findMany({
      where: { engagementId },
      select: { id: true, title: true, description: true, sources: true },
    });
    const { fresh, merges } = dedupFindings(findings, existing, job.tool, host);
    if (fresh.length > 0) {
      const enriched = await enrichFindingsIntel(fresh);
      await prisma.finding.createMany({ data: enriched.map((f) => ({ ...f, engagementId })) });
    }
    for (const m of merges) {
      await prisma.finding.update({ where: { id: m.id }, data: { sources: m.sources } }).catch(() => {});
    }
    if (fresh.length > 0 || merges.length > 0) {
      await prisma.engagement.update({ where: { id: engagementId }, data: { updatedAt: new Date() } });
    }
  }

  revalidatePath("/dashboard/runners");
  redirect(`/dashboard/engagements/${engagementId}`);
}
