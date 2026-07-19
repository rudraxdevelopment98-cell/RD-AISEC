import { NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Self-service runner enrollment. A machine with no valid token POSTs a reusable
 * enrollment code (from the portal → Runners) and receives a fresh runner token.
 * NOT bearer-authenticated — the enrollment code IS the credential, so a machine
 * that lost/rotated its token can re-enroll without a human editing systemd.
 *
 * If the machine sends a stable `fingerprint`, a re-enroll reclaims its SAME
 * runner row and rotates the token in place (no duplicate machines). Otherwise a
 * new runner is created.
 *
 *   POST { code, name?, fingerprint? } -> { token, id, name }
 */
export async function POST(req: Request) {
  let body: { code?: unknown; name?: unknown; fingerprint?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const code = String(body.code ?? "").trim();
  if (!code) return NextResponse.json({ error: "Missing enrollment code" }, { status: 400 });

  const codeHash = createHash("sha256").update(code).digest("hex");
  const ec = await prisma.enrollCode.findUnique({ where: { codeHash } });
  if (!ec || ec.revoked) {
    return NextResponse.json({ error: "Unknown or revoked enrollment code" }, { status: 401 });
  }
  if (ec.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "Enrollment code has expired" }, { status: 401 });
  }

  const token = "rdr_" + randomBytes(24).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const fingerprint = String(body.fingerprint ?? "").slice(0, 128);
  const name =
    String(body.name ?? "").trim().slice(0, 80) || ec.label || "Enrolled machine";

  // Re-enroll of a known machine → rotate its token in place. This does NOT consume
  // a use slot (a machine self-healing its token must not exhaust the code), and is
  // not blocked by the use limit — it's an existing machine, not a new one.
  let runnerId: string | null = null;
  if (fingerprint) {
    const existing = await prisma.runner.findFirst({
      where: { ownerEmail: ec.ownerEmail, fingerprint },
      select: { id: true },
    });
    if (existing) {
      await prisma.runner.update({ where: { id: existing.id }, data: { tokenHash, name } });
      await prisma.enrollCode.update({ where: { id: ec.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
      runnerId = existing.id;
    }
  }
  if (!runnerId) {
    // New machine → atomically claim a use slot. The guarded updateMany makes the
    // limit check + increment a single write, so two concurrent enrolls of a
    // maxUses:1 code can't both pass (TOCTOU).
    const claimed = await prisma.enrollCode.updateMany({
      where: { id: ec.id, revoked: false, usedCount: { lt: ec.maxUses }, expiresAt: { gt: new Date() } },
      data: { usedCount: { increment: 1 }, lastUsedAt: new Date() },
    });
    if (claimed.count !== 1) {
      return NextResponse.json({ error: "Enrollment code has reached its use limit" }, { status: 429 });
    }
    const created = await prisma.runner.create({
      data: { name, tokenHash, ownerEmail: ec.ownerEmail, fingerprint },
      select: { id: true },
    });
    runnerId = created.id;
  }
  await logAudit({
    type: "runner.enroll",
    actor: ec.ownerEmail,
    summary: `Machine enrolled a runner token (${name})`,
    target: runnerId,
    meta: { reenroll: !!fingerprint && ec.usedCount > 0 },
  }).catch(() => {});

  return NextResponse.json({ token, id: runnerId, name });
}
