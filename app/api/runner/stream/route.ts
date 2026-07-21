import { NextResponse } from "next/server";
import { authenticateRunner } from "@/lib/runner-auth";
import { prisma } from "@/lib/db";
import { RUNNER_ONLINE_WINDOW_MS } from "@/lib/runner-constants";

export const dynamic = "force-dynamic";
// Hold the stream open ~25s per connection; the runner reconnects immediately.
// Vercel caps this at the plan's function limit — if it's lower, the connection
// just drops early and the runner reconnects (handled), so this is a ceiling.
export const maxDuration = 30;

const STREAM_MS = 25_000;
const TICK_MS = 2_500;

/**
 * Live command stream (Server-Sent Events) — the push half of the runner channel.
 *
 * The runner holds ONE of these open instead of polling. While it's open the
 * machine is "online" (presence = an active connection, refreshed each tick — no
 * more discrete-heartbeat gaps that flapped it offline). The portal pushes:
 *   • event: wake     — there is queued work; claim it now (no 5s wait)
 *   • event: cancel   — jobs were canceled; kill them
 *   • event: restart  — portal asked this machine to restart
 *   • event: ping     — keepalive
 * Job CLAIMING stays on the proven /api/runner/job route (the runner claims on a
 * wake), so this endpoint never races the claim logic — it only notifies.
 */
export async function GET(req: Request) {
  const runner = await authenticateRunner(req);
  if (!runner) {
    return NextResponse.json({ error: "Invalid runner token" }, { status: 401 });
  }
  const runnerId = runner.id;
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

      send("hello", { ok: true, streamMs: STREAM_MS });
      const started = Date.now();
      let tick = 0;
      let lastWake = 0;

      try {
        while (!closed && Date.now() - started < STREAM_MS) {
          tick++;
          // Presence — refresh lastSeenAt while connected. This is what keeps the
          // machine "online" now; the open connection IS the heartbeat.
          await prisma.runner
            .update({ where: { id: runnerId }, data: { lastSeenAt: new Date() } })
            .catch(() => {});

          // Portal-requested restart (delivered once).
          const r = await prisma.runner
            .findUnique({ where: { id: runnerId }, select: { restartRequested: true } })
            .catch(() => null);
          if (r?.restartRequested) {
            await prisma.runner
              .update({ where: { id: runnerId }, data: { restartRequested: false } })
              .catch(() => {});
            send("restart", {});
          }

          // Queued work for this runner (or an orphaned/adoptable job)? Tell it to
          // claim now. Throttle wake to ~5s so we don't spam while it's claiming.
          if (Date.now() - lastWake > 5_000) {
            const cutoff = new Date(Date.now() - RUNNER_ONLINE_WINDOW_MS);
            const stale = await prisma.runner
              .findMany({
                where: { id: { not: runnerId }, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }] },
                select: { id: true },
              })
              .catch(() => [] as { id: string }[]);
            const adoptable = stale.map((s) => s.id);
            const pending = await prisma.job
              .count({
                where: {
                  status: "queued",
                  OR: [{ runnerId }, { runnerId: null }, { runnerId: { in: adoptable } }],
                },
              })
              .catch(() => 0);
            if (pending > 0) {
              send("wake", { pending });
              lastWake = Date.now();
            }
          }

          // Jobs canceled from the portal in the last minute → kill them.
          const since = new Date(Date.now() - 60_000);
          const canceled = await prisma.job
            .findMany({
              where: { runnerId, status: "canceled", finishedAt: { gte: since } },
              select: { id: true },
              take: 50,
            })
            .catch(() => [] as { id: string }[]);
          if (canceled.length) send("cancel", { ids: canceled.map((c) => c.id) });

          send("ping", { t: Date.now(), tick });
          await new Promise((res) => setTimeout(res, TICK_MS));
        }
      } catch {
        // client disconnected or a write failed — fall through to close
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
      // Ask any intermediary proxy not to buffer, so events arrive live.
      "X-Accel-Buffering": "no",
    },
  });
}
