import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isOwnerEmail } from "@/lib/members";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const STREAM_MS = 25_000;
const TICK_MS = 300; // browser-side tail is snappy while a terminal is open

/**
 * Browser output stream for a control session (SSE). Streams the runner's
 * dir="out" frames (PTY bytes / file chunks / results) to the terminal UI, in
 * order by seq, resuming from ?after=. Owner-authenticated. ~25s hold, then the
 * client reconnects with its last seq.
 */
export async function GET(
  req: Request,
  { params }: { params: { sessionId: string } },
) {
  const session = await auth();
  const email = session?.user?.email ?? "";
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cs = await prisma.controlSession.findUnique({
    where: { id: params.sessionId },
    select: { id: true, ownerEmail: true, runner: { select: { ownerEmail: true } } },
  });
  if (!cs) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const owns = cs.ownerEmail === email || cs.runner.ownerEmail === email || isOwnerEmail(email);
  if (!owns) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  let cursor = Math.max(0, Number(url.searchParams.get("after") ?? 0) || 0);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      send("hello", { after: cursor });
      const started = Date.now();
      try {
        while (!closed && Date.now() - started < STREAM_MS) {
          const rows = await prisma.controlMessage
            .findMany({
              where: { sessionId: params.sessionId, dir: "out", seq: { gt: cursor } },
              orderBy: { seq: "asc" },
              take: 500,
            })
            .catch(() => []);
          for (const r of rows) {
            send("msg", { seq: r.seq, kind: r.kind, data: r.data });
            cursor = r.seq;
          }
          const st = await prisma.controlSession
            .findUnique({ where: { id: params.sessionId }, select: { status: true } })
            .catch(() => null);
          if (st?.status === "closed" || st?.status === "error") {
            send("closed", { status: st.status });
            break;
          }
          await new Promise((res) => setTimeout(res, TICK_MS));
        }
      } catch {
        /* client gone */
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
