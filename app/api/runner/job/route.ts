import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateRunner } from "@/lib/runner-auth";
import { decryptSecret } from "@/lib/crypto";
import { supportsAuthHeader, authArgvForTool } from "@/lib/auth-scan";
import { RUNNER_ONLINE_WINDOW_MS } from "@/lib/runner-constants";

export const dynamic = "force-dynamic";

/** Clamp an hour to 0–23, falling back to a default when unset/invalid. */
function clampHour(v: number | undefined | null, fallback: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.max(0, Math.min(23, n));
}

/**
 * The runner polls this endpoint for its next job. Authenticated by the runner
 * bearer token (NOT a user session). Atomically claims the oldest queued job
 * assigned to this runner and returns its tool/target/args. 204 when idle.
 */
export async function GET(req: Request) {
  const runner = await authenticateRunner(req);
  if (!runner) {
    return NextResponse.json({ error: "Invalid runner token" }, { status: 401 });
  }

  // Tell the runner its desired anonymity + parallelism on every poll (idle or
  // not), so changing them in the portal takes effect without restarting it.
  const anon = runner.anonymity ? "on" : "off";
  const workers = String(Math.min(16, Math.max(1, runner.maxWorkers || 3)));
  // Portal-controlled maintenance schedule — pushed every poll so edits in the UI
  // take effect without restarting the runner.
  const maintEnabled = (runner as { maintEnabled?: boolean }).maintEnabled === false ? "0" : "1";
  const startH = clampHour((runner as { maintStartHour?: number }).maintStartHour, 6);
  const endH = clampHour((runner as { maintEndHour?: number }).maintEndHour, 8);
  const setHeaders = (r: NextResponse) => {
    r.headers.set("X-Runner-Anonymity", anon);
    r.headers.set("X-Runner-Max-Workers", workers);
    r.headers.set("X-Runner-Maint-Enabled", maintEnabled);
    r.headers.set("X-Runner-Maint-Window", `${startH}-${endH}`);
    return r;
  };
  const idle = () => setHeaders(new NextResponse(null, { status: 204 }));

  // Adoption scope: besides this runner's own jobs, a live runner also picks up
  // jobs that would otherwise be stuck forever — orphaned ones (runnerId null,
  // e.g. their runner was deleted) and ones stranded on a runner that's gone
  // offline (e.g. it was replaced with a new token). Jobs on OTHER online runners
  // are left alone, so live runners never steal each other's work.
  const cutoff = new Date(Date.now() - RUNNER_ONLINE_WINDOW_MS);
  const staleRunners = await prisma.runner.findMany({
    where: { id: { not: runner.id }, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }] },
    select: { id: true },
  });
  const adoptableIds = staleRunners.map((r: { id: string }) => r.id);

  // ── Reclaim abandoned "running" jobs ────────────────────────────────────────
  // A job goes to "running" the moment it's claimed. If the runner then dies /
  // goes offline before posting a result (the recurring offline problem), the
  // job would otherwise sit "running" FOREVER — never finishing, never retried,
  // so the queue looks stuck and "nothing runs". On every poll we put such jobs
  // back to "queued" so they get picked up again:
  //   • jobs whose owning runner is offline/deleted (it can't finish them), and
  //   • any job stuck "running" past a hard cap (runner restarted mid-job, or a
  //     hung tool) — well beyond the longest real tool timeout.
  // A freshly-(re)started runner sends X-Runner-Boot on its first poll. Its old
  // process is gone, so any job it still shows "running" is abandoned — requeue
  // this runner's own running jobs immediately (covers graceful self-update /
  // restart, which don't trip the offline window above).
  if (req.headers.get("x-runner-boot") === "1") {
    await prisma.job
      .updateMany({
        where: { runnerId: runner.id, status: "running" },
        data: { status: "queued", startedAt: null },
      })
      .catch(() => ({ count: 0 }));
  }

  const STUCK_RUNNING_MS = 45 * 60 * 1000; // 45 min
  await prisma.job
    .updateMany({
      where: {
        status: "running",
        OR: [
          { runnerId: null },
          { runnerId: { in: adoptableIds } },
          { startedAt: { lt: new Date(Date.now() - STUCK_RUNNING_MS) } },
        ],
      },
      data: { status: "queued", startedAt: null },
    })
    .catch(() => ({ count: 0 }));

  // Claim the highest-priority queued job (ties broken by age), with a guarded
  // update so two concurrent polls can't grab the same job. "Run next" / "Run
  // first" raise a job's priority above the rest of the queue.
  for (let attempt = 0; attempt < 4; attempt++) {
    let next = await prisma.job.findFirst({
      where: { runnerId: runner.id, status: "queued" },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
    if (!next) {
      // Nothing of ours — adopt an orphaned / stranded job.
      next = await prisma.job.findFirst({
        where: { status: "queued", OR: [{ runnerId: null }, { runnerId: { in: adoptableIds } }] },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      });
    }
    if (!next) return idle();

    const claimed = await prisma.job.updateMany({
      where: { id: next.id, status: "queued" },
      // Reassign to this runner as we claim it (a no-op for our own jobs; adopts
      // orphaned/stranded ones so results post back correctly).
      data: { status: "running", startedAt: new Date(), runnerId: runner.id },
    });
    if (claimed.count === 1) {
      // Authenticated / session-aware scanning: if this engagement carries a
      // stored auth session and the tool can take a request header, decrypt it
      // here (never persisted in the Job row) and hand the runner the exact,
      // pre-computed argv tokens to inject — the header value as a single
      // element, so no shell and no re-splitting. Best-effort: a missing/broken
      // session just runs the scan unauthenticated.
      let authArgv: string[] = [];
      if (next.engagementId && supportsAuthHeader(next.tool)) {
        try {
          const eng = await prisma.engagement.findUnique({
            where: { id: next.engagementId },
            select: { authSession: true },
          });
          const header = eng?.authSession ? decryptSecret(eng.authSession) : "";
          if (header) authArgv = authArgvForTool(next.tool, header);
        } catch {
          authArgv = [];
        }
      }
      return setHeaders(
        NextResponse.json({
          id: next.id,
          tool: next.tool,
          target: next.target,
          args: next.args,
          ...(authArgv.length > 0 ? { authArgv } : {}),
        }),
      );
    }
    // Lost the race; loop and try the next queued job.
  }
  return idle();
}
