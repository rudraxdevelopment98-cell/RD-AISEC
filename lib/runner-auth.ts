// Server-side helpers for authenticating a Runner by its bearer token.
// Not a "use server" module — imported by API route handlers.
import { createHash } from "crypto";
import { prisma } from "@/lib/db";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Read "Authorization: Bearer <token>" from the request, resolve the runner,
 * and stamp lastSeenAt. Returns the runner or null if the token is missing/bad.
 */
export async function authenticateRunner(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return null;
  const token = m[1].trim();
  if (!token) return null;

  const runner = await prisma.runner.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!runner) return null;

  // The runner reports its version + loaded-tool count via headers on each poll.
  const version = (req.headers.get("x-runner-version") ?? "").slice(0, 20);
  const toolsHeader = req.headers.get("x-runner-tools") ?? "";
  const toolCount = toolsHeader
    ? toolsHeader.split(",").map((t) => t.trim()).filter(Boolean).length
    : runner.toolCount;
  // Tor exit IP it reports while anonymity is on (only persist when anonymity is on).
  const exitHeader = (req.headers.get("x-runner-exit-ip") ?? "").slice(0, 64);
  const exitIp = runner.anonymity ? exitHeader : "";
  // Local subnets the runner detected (for one-click "scan this network").
  const subnets = (req.headers.get("x-runner-subnets") ?? "").slice(0, 512);
  // Which allowlisted tools actually have a binary present on the runner.
  const installed = (req.headers.get("x-runner-installed") ?? "").slice(0, 512);

  await prisma.runner
    .update({
      where: { id: runner.id },
      data: {
        lastSeenAt: new Date(),
        ...(version ? { version } : {}),
        toolCount,
        ...(runner.anonymity ? { exitIp } : {}),
        ...(subnets ? { subnets } : {}),
        installed,
      },
    })
    .catch(() => {});
  return runner;
}
