import { NextResponse } from "next/server";
import { runDueSchedules } from "@/lib/scheduled-core";

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
  return NextResponse.json({ ok: true, ...result });
}
