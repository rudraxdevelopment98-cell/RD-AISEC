import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { RUNNER_ONLINE_WINDOW_MS } from "@/lib/runner-constants";

export const dynamic = "force-dynamic";

/**
 * Lightweight live-activity feed for the footer status bar: how many machines
 * are online (+ their CPU/RAM/temp when reported), how many jobs are running /
 * queued, and a rough ETA for the current work. Polled every few seconds by the
 * client, so keep it cheap (counts + a tiny select).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const [runners, running, queued, recent] = await Promise.all([
    prisma.runner.findMany({
      orderBy: { lastSeenAt: "desc" },
      select: {
        name: true,
        lastSeenAt: true,
        cpuPct: true,
        memPct: true,
        memUsedMb: true,
        memTotalMb: true,
        diskUsedMb: true,
        diskTotalMb: true,
        tempC: true,
        loadAvg: true,
      },
    }),
    prisma.job.count({ where: { status: "running" } }),
    prisma.job.count({ where: { status: "queued" } }),
    // Recent finished jobs → average duration, for the ETA estimate.
    prisma.job.findMany({
      where: { status: { in: ["done", "failed"] }, startedAt: { not: null }, finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
      take: 30,
      select: { startedAt: true, finishedAt: true },
    }),
  ]);

  const online = runners.filter(
    (r) => r.lastSeenAt && now - new Date(r.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS,
  );

  // Average recent job duration (seconds); fall back to a sane default.
  const durs = recent
    .map((j) => (new Date(j.finishedAt!).getTime() - new Date(j.startedAt!).getTime()) / 1000)
    .filter((s) => s > 0 && s < 3600);
  const avgSec = durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 90;

  // Rough remaining time: queued jobs run avgSec each (÷ parallel workers), plus
  // running jobs are ~half done on average.
  const workers = Math.max(1, online.length) * 3;
  const etaSeconds =
    running + queued > 0
      ? Math.round((queued / workers) * avgSec + running * avgSec * 0.5)
      : 0;

  const busiest = online
    .filter((r) => r.cpuPct != null)
    .sort((a, b) => (b.cpuPct ?? 0) - (a.cpuPct ?? 0))[0] ?? null;

  return NextResponse.json({
    onlineRunners: online.length,
    running,
    queued,
    etaSeconds,
    machine: busiest
      ? {
          name: busiest.name,
          cpuPct: busiest.cpuPct,
          memPct: busiest.memPct,
          memUsedMb: busiest.memUsedMb,
          memTotalMb: busiest.memTotalMb,
          diskUsedMb: busiest.diskUsedMb,
          diskTotalMb: busiest.diskTotalMb,
          tempC: busiest.tempC,
          loadAvg: busiest.loadAvg,
        }
      : null,
  });
}
