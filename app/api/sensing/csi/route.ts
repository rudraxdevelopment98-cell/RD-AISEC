import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Latest CSI ("WiFi camera") analysis for the signed-in owner — the UI polls
 * this. The analysis is produced + stored by /api/runner/csi when a CSI collector
 * posts frames. Returns { fresh, ageMs, analysis } or a null analysis if none.
 */
export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const row = await prisma.csiCapture.findUnique({ where: { ownerEmail: email } });
  if (!row || !row.data) return NextResponse.json({ analysis: null });

  let analysis: unknown = null;
  try {
    analysis = JSON.parse(row.data);
  } catch {
    return NextResponse.json({ analysis: null });
  }
  const at = (analysis as { at?: number })?.at ?? new Date(row.updatedAt).getTime();
  const ageMs = Date.now() - at;
  // Consider a capture "fresh" (live) if it arrived in the last 15 seconds.
  return NextResponse.json({ analysis, ageMs, fresh: ageMs < 15_000, frames: row.frames });
}
