import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { RUNNER_ONLINE_WINDOW_MS } from "@/lib/runner-constants";
import { parseWifiSense, motionTimeline, analyzeMotion } from "@/lib/wifi-sense-core";
import { occupancyField } from "@/lib/wifi-fusion-core";

export const dynamic = "force-dynamic";

const IFACE_RE = /^[a-zA-Z0-9_.-]{1,32}$/;

/** Launch a real WiFi-sensing sample on a runner interface. */
export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const runnerId = String(body?.runnerId ?? "");
  const iface = String(body?.iface ?? "").trim();
  let seconds = Number(body?.seconds ?? 20);
  seconds = Math.max(4, Math.min(40, Math.round(Number.isFinite(seconds) ? seconds : 20)));

  if (!runnerId || !IFACE_RE.test(iface)) {
    return NextResponse.json({ error: "Pick a machine and a valid interface." }, { status: 400 });
  }
  const runner = await prisma.runner.findUnique({ where: { id: runnerId }, select: { id: true, lastSeenAt: true } });
  if (!runner) return NextResponse.json({ error: "Machine not found." }, { status: 404 });
  const online = runner.lastSeenAt && Date.now() - new Date(runner.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS;
  if (!online) return NextResponse.json({ error: "That machine is offline." }, { status: 409 });

  const job = await prisma.job.create({
    data: {
      tool: "wifisense",
      target: iface,
      args: String(seconds),
      runnerId,
      status: "queued",
      priority: 5, // jump ahead of scan backlog so sensing feels live
      queuedBy: email,
    },
    select: { id: true },
  });
  return NextResponse.json({ jobId: job.id, seconds });
}

/** Poll a sensing job: returns status, and the motion timeline once done. */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("job") ?? "";
  if (!id) return NextResponse.json({ error: "No job id." }, { status: 400 });

  const job = await prisma.job.findUnique({
    where: { id },
    select: { id: true, status: true, output: true, tool: true },
  });
  if (!job || job.tool !== "wifisense") return NextResponse.json({ error: "Not found." }, { status: 404 });

  if (job.status === "done") {
    const parsed = parseWifiSense(job.output ?? "");
    const timeline = parsed ? motionTimeline(parsed) : null;
    // Precise analysis (speed/direction/range/breathing/person/activity) + the
    // top-down "WiFi camera" occupancy field — both from the real RSSI capture.
    const analysis = parsed ? analyzeMotion(parsed) : null;
    const spatial = analysis ? occupancyField(analysis) : null;
    return NextResponse.json({ status: "done", timeline, analysis, spatial });
  }
  return NextResponse.json({ status: job.status });
}
