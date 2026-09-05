import { NextResponse } from "next/server";
import { runDueSchedules } from "@/lib/scheduled-core";
import { runDueHackerOneSyncs, runDueBugPrograms } from "@/lib/bug-pipeline";
import { sweepStaleJobs } from "@/lib/pipeline-engine";
import { runAutopilot } from "@/lib/autopilot";
import { pruneRetention } from "@/lib/retention";

// Long-running: scanning several targets can take a while.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Vercel Cron entry point (see vercel.json). Runs every enabled schedule whose
 * interval has elapsed. Protected by CRON_SECRET — Vercel sends
 * `Authorization: Bearer <CRON_SECRET>` on scheduled invocations. Fails CLOSED:
 * if CRON_SECRET isn't configured, the endpoint is disabled (never public).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Recover jobs/pipelines stuck on dead runners before running new work.
  let swept = 0;
  try {
    swept = await sweepStaleJobs();
  } catch {
    /* don't let the sweep break the rest of the cron */
  }

  const result = await runDueSchedules();

  // Bug-bounty automation: refresh HackerOne programs, then run due pipelines.
  let bug = { synced: 0, programs: 0, jobs: 0 };
  try {
    const synced = await runDueHackerOneSyncs();
    const due = await runDueBugPrograms();
    bug = { synced, ...due };
  } catch {
    /* don't let bug automation break the posture-scan cron */
  }

  // Autopilot: keep every authorized autopilot engagement's self-approving
  // pipeline running / advancing. Never lets one engagement break the cron.
  let autopilot = null;
  try {
    autopilot = await runAutopilot();
  } catch {
    /* autopilot is best-effort */
  }

  // Data retention: prune aged append-only rows (control-stream bytes, old audit
  // events, archived jobs) so the DB stays lean. Never blocks the rest of the cron.
  let pruned = null;
  try {
    pruned = await pruneRetention();
  } catch {
    /* retention is best-effort */
  }

  return NextResponse.json({ ok: true, swept, ...result, bug, autopilot, pruned });
}
