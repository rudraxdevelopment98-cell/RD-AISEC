"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isOwnerEmail } from "@/lib/members";
import { logAudit } from "@/lib/audit";

// How long an "unlock full control" window lasts. Full control is remote code
// execution, so it's deliberately time-boxed and auto-expires.
const UNLOCK_MINUTES = 45;
// Kinds that require the machine to be unlocked (RCE-class). "proc" (read-only
// process list) is allowed without unlock; everything else needs it.
const PRIVILEGED_KINDS = new Set(["pty", "file", "service", "install"]);

export type ControlActor = { email: string };

/**
 * Resolve the current user and assert they may control this runner: they own it,
 * or they're an owner-role member. Returns {email} or throws.
 */
export async function assertRunnerOwner(runnerId: string): Promise<ControlActor> {
  const session = await auth();
  const email = session?.user?.email ?? "";
  if (!email) throw new Error("Not signed in.");
  const runner = await prisma.runner.findUnique({
    where: { id: runnerId },
    select: { ownerEmail: true },
  });
  if (!runner) throw new Error("Machine not found.");
  if (runner.ownerEmail !== email && !isOwnerEmail(email)) {
    throw new Error("You don't have control of this machine.");
  }
  return { email };
}

/** Is the machine currently unlocked for full control? */
export async function isUnlocked(runnerId: string): Promise<boolean> {
  const r = await prisma.runner.findUnique({
    where: { id: runnerId },
    select: { fullControlUntil: true },
  });
  return !!r?.fullControlUntil && r.fullControlUntil.getTime() > Date.now();
}

/** Owner-only, time-boxed unlock of full control on a machine. Audited. */
export async function unlockFullControl(formData: FormData): Promise<void> {
  const runnerId = String(formData.get("runnerId") ?? "");
  const { email } = await assertRunnerOwner(runnerId);
  const until = new Date(Date.now() + UNLOCK_MINUTES * 60_000);
  await prisma.runner.update({
    where: { id: runnerId },
    data: { fullControlUntil: until, fullControlBy: email },
  });
  await logAudit({
    type: "control.unlock",
    actor: email,
    summary: `Unlocked full control for ${UNLOCK_MINUTES} min`,
    target: runnerId,
  }).catch(() => {});
}

/** Re-lock full control immediately. Audited. */
export async function lockFullControl(formData: FormData): Promise<void> {
  const runnerId = String(formData.get("runnerId") ?? "");
  const { email } = await assertRunnerOwner(runnerId);
  await prisma.runner.update({
    where: { id: runnerId },
    data: { fullControlUntil: null },
  });
  await logAudit({ type: "control.lock", actor: email, summary: "Locked full control", target: runnerId })
    .catch(() => {});
}

/**
 * Open a control session (returns its id). Privileged kinds (pty/file/service/
 * install) require the machine to be unlocked. Audited at session boundary.
 */
export async function openControlSession(opts: {
  runnerId: string;
  kind?: string;
  cols?: number;
  rows?: number;
  asRoot?: boolean;
}): Promise<{ id: string }> {
  const { email } = await assertRunnerOwner(opts.runnerId);
  const kind = String(opts.kind ?? "pty");
  if (PRIVILEGED_KINDS.has(kind) && !(await isUnlocked(opts.runnerId))) {
    throw new Error("Machine is locked. Unlock full control first.");
  }
  const cols = Math.max(20, Math.min(500, opts.cols ?? 80));
  const rows = Math.max(5, Math.min(200, opts.rows ?? 24));
  const asRoot = !!opts.asRoot;
  const s = await prisma.controlSession.create({
    data: { runnerId: opts.runnerId, ownerEmail: email, kind, cols, rows, asRoot },
    select: { id: true },
  });
  // Seed the "open" frame so the runner spins up the PTY as soon as the stream
  // delivers it — the browser doesn't need to send anything to start the terminal.
  if (kind === "pty") {
    await prisma.controlMessage
      .create({
        data: { sessionId: s.id, dir: "in", kind: "open", data: JSON.stringify({ cols, rows, asRoot }) },
      })
      .catch(() => {});
  }
  await logAudit({
    type: "control.session.open",
    actor: email,
    summary: `Opened ${kind} session${opts.asRoot ? " (root)" : ""}`,
    target: opts.runnerId,
  }).catch(() => {});
  return s;
}

/** Close a control session (owner-checked). The runner tears down the PTY on next poll. */
export async function closeControlSession(sessionId: string): Promise<void> {
  const session = await prisma.controlSession.findUnique({
    where: { id: sessionId },
    select: { runnerId: true },
  });
  if (!session) return;
  const { email } = await assertRunnerOwner(session.runnerId);
  await prisma.controlSession.update({
    where: { id: sessionId },
    data: { status: "closed", closedAt: new Date() },
  });
  await logAudit({ type: "control.session.close", actor: email, summary: "Closed session", target: sessionId })
    .catch(() => {});
}
