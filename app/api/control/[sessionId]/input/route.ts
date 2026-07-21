import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isOwnerEmail } from "@/lib/members";

export const dynamic = "force-dynamic";

const MAX_BATCH = 100;
const MAX_DATA = 32_768;
const IN_KINDS = new Set([
  "data", "resize", "signal", "close",
  "file-open", "file-chunk", "file-eof", "ls", "proc", "svc", "install",
]);

/**
 * Browser input for a control session (portal -> runner). Writes dir="in" frames
 * (keystrokes, resize, signals, file/proc/service/install commands) that the
 * unified /api/runner/stream delivers to the runner. Owner-authenticated; the
 * session must be open and, for privileged kinds, the machine must be unlocked.
 *
 *   POST { messages: [{ kind, data }, ...] }  or  { kind, data }
 */
export async function POST(
  req: Request,
  { params }: { params: { sessionId: string } },
) {
  const auths = await auth();
  const email = auths?.user?.email ?? "";
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cs = await prisma.controlSession.findUnique({
    where: { id: params.sessionId },
    select: {
      id: true,
      status: true,
      ownerEmail: true,
      runner: { select: { ownerEmail: true, fullControlUntil: true } },
    },
  });
  if (!cs) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const owns = cs.ownerEmail === email || cs.runner.ownerEmail === email || isOwnerEmail(email);
  if (!owns) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (cs.status === "closed" || cs.status === "error") {
    return NextResponse.json({ error: "Session closed" }, { status: 409 });
  }
  // Full control must be unlocked to send input to a live machine.
  const unlocked = !!cs.runner.fullControlUntil && cs.runner.fullControlUntil.getTime() > Date.now();
  if (!unlocked) {
    return NextResponse.json({ error: "Machine locked — unlock full control first." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = Array.isArray(body.messages) ? body.messages : [body];
  const rows = raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
    .slice(0, MAX_BATCH)
    .map((m) => {
      const kind = String(m.kind ?? "data");
      return {
        sessionId: params.sessionId,
        dir: "in",
        kind: IN_KINDS.has(kind) ? kind : "data",
        data: String(m.data ?? "").slice(0, MAX_DATA),
      };
    });
  if (rows.length === 0) return NextResponse.json({ ok: true, written: 0 });

  await prisma.controlMessage.createMany({ data: rows }).catch(() => {});
  return NextResponse.json({ ok: true, written: rows.length });
}
