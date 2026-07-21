import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateRunner } from "@/lib/runner-auth";

export const dynamic = "force-dynamic";

const MAX_BATCH = 100;
const MAX_DATA = 32_768; // 32 KB per frame (base64 PTY chunk or JSON control frame)
const OUT_KINDS = new Set([
  "data", "exit", "error", "open", "close",
  "file-chunk", "file-eof", "ls", "proc", "svc", "install",
]);

/**
 * Control up-channel (runner -> portal). The runner posts session output frames
 * (PTY bytes, file chunks, proc/service/install results). Bearer-authed by the
 * runner token; the session must belong to THIS runner. Rows are appended with
 * dir="out" and tailed by the browser via /api/control/[id]/stream.
 *
 *   POST { sessionId, messages: [{ kind, data }, ...] }
 */
export async function POST(req: Request) {
  const runner = await authenticateRunner(req);
  if (!runner) {
    return NextResponse.json({ error: "Invalid runner token" }, { status: 401 });
  }

  let body: { sessionId?: unknown; messages?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = String(body.sessionId ?? "");
  const session = await prisma.controlSession.findUnique({
    where: { id: sessionId },
    select: { id: true, runnerId: true, status: true },
  });
  if (!session || session.runnerId !== runner.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const raw = Array.isArray(body.messages) ? body.messages : [];
  const rows = raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
    .slice(0, MAX_BATCH)
    .map((m) => {
      const kind = String(m.kind ?? "data");
      return {
        sessionId,
        dir: "out",
        kind: OUT_KINDS.has(kind) ? kind : "data",
        data: String(m.data ?? "").slice(0, MAX_DATA),
      };
    });

  if (rows.length === 0) return NextResponse.json({ ok: true, written: 0 });

  // A terminating frame closes the session; keep it live-marked otherwise.
  const terminal = rows.some((r) => r.kind === "exit" || r.kind === "close");
  await Promise.all([
    prisma.controlMessage.createMany({ data: rows }).catch(() => {}),
    prisma.controlSession
      .update({
        where: { id: sessionId },
        data: {
          lastActivityAt: new Date(),
          ...(session.status === "opening" ? { status: "open" } : {}),
          ...(terminal ? { status: "closed", closedAt: new Date() } : {}),
        },
      })
      .catch(() => {}),
  ]);
  return NextResponse.json({ ok: true, written: rows.length });
}
