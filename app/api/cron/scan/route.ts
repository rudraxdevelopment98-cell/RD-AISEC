import { NextResponse } from "next/server";
import { runDueSchedules } from "@/lib/scheduled-core";
import { runDueHackerOneSyncs, runDueBugPrograms } from "@/lib/bug-pipeline";

// Long-running: scanning several targets can take a while.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Vercel Cron entry point (see vercel.json). Runs every enabled schedule whose
 * interval has elapsed. Protected by CRON_SECRET: Vercel automatically sends
 * `Authorization: Bearer <CRON_SECRET>` on scheduled invocations when that env
 * var is set, so we reject anything that doesn't match.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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

  return NextResponse.json({ ok: true, ...result, bug });
}
