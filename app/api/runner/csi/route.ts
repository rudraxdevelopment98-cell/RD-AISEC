import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateRunner } from "@/lib/runner-auth";
import { analyzeCsi, parseCsiFrames } from "@/lib/wifi-csi-core";

export const dynamic = "force-dynamic";

/**
 * CSI ingestion — a CSI collector (ESP32-CSI / nexmon / Intel 5300) POSTs a batch
 * of Channel State Information frames here using the RUNNER bearer token. We run
 * the imaging analysis server-side and upsert the latest result for the runner's
 * owner, so the Sensing UI can poll it. Body: { frames: CsiFrame[], band?, roomM? }.
 */
export async function POST(req: Request) {
  const runner = await authenticateRunner(req);
  if (!runner) return NextResponse.json({ error: "Invalid runner token" }, { status: 401 });

  const owner = runner.ownerEmail;
  if (!owner) return NextResponse.json({ error: "Runner has no owner" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const frames = parseCsiFrames(body);
  if (frames.length < 16) {
    return NextResponse.json({ error: "Need ≥16 CSI frames.", got: frames.length }, { status: 400 });
  }

  const band = body?.band === "5" ? "5" : "2.4";
  const roomM = Number(body?.roomM) > 0 ? Math.min(40, Number(body.roomM)) : undefined;
  const antSpacing = Number(body?.antSpacing) > 0 ? Number(body.antSpacing) : undefined;

  const analysis = analyzeCsi(frames, { band, roomM, antSpacing });
  const data = JSON.stringify({ ...analysis, at: Date.now() });

  await prisma.csiCapture.upsert({
    where: { ownerEmail: owner },
    create: { ownerEmail: owner, data, frames: frames.length },
    update: { data, frames: frames.length },
  });

  // Echo a compact summary so the collector can log what was detected.
  return NextResponse.json({
    ok: true,
    present: analysis.present,
    occupancy: analysis.occupancy,
    velocityMps: analysis.velocityMps,
    azimuthDeg: analysis.azimuthDeg,
    breathingBpm: analysis.breathingBpm,
    heartBpm: analysis.heartBpm,
  });
}
