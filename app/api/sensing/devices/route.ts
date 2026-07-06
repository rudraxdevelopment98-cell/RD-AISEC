import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { RUNNER_ONLINE_WINDOW_MS } from "@/lib/runner-constants";
import { parseDevices, deviceSummary } from "@/lib/devices-core";

export const dynamic = "force-dynamic";

/**
 * "What's on my WiFi" — queue a fast LAN discovery (nmap ping sweep) on a
 * runner's own subnet. This answers the connected-DEVICES question honestly and
 * separately from motion sensing (devices ≠ people). POST → jobId; GET → parsed
 * device list once the scan finishes.
 */
export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const runnerId = String(body?.runnerId ?? "");
  const runner = await prisma.runner.findUnique({
    where: { id: runnerId },
    select: { id: true, lastSeenAt: true, subnets: true },
  });
  if (!runner) return NextResponse.json({ error: "Machine not found." }, { status: 404 });
  const online = runner.lastSeenAt && Date.now() - new Date(runner.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS;
  if (!online) return NextResponse.json({ error: "That machine is offline." }, { status: 409 });

  const subnet = String(runner.subnets ?? "").split(",").map((s) => s.trim()).filter(Boolean)[0];
  if (!subnet) return NextResponse.json({ error: "This machine hasn't reported a local subnet yet." }, { status: 409 });

  const job = await prisma.job.create({
    data: {
      tool: "nmap",
      target: subnet,
      args: "-sn -T4", // ping sweep: live hosts, no ports — fast + no root needed
      runnerId: runner.id,
      status: "queued",
      priority: 6,
      queuedBy: email,
    },
    select: { id: true },
  });
  return NextResponse.json({ jobId: job.id, subnet });
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("job") ?? "";
  if (!id) return NextResponse.json({ error: "No job id." }, { status: 400 });

  const job = await prisma.job.findUnique({
    where: { id },
    select: { status: true, output: true, tool: true },
  });
  if (!job || job.tool !== "nmap") return NextResponse.json({ error: "Not found." }, { status: 404 });

  if (job.status === "done") {
    const devices = parseDevices(job.output ?? "");
    return NextResponse.json({ status: "done", devices, summary: deviceSummary(devices) });
  }
  return NextResponse.json({ status: job.status });
}
