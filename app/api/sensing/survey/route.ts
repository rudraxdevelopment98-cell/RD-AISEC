import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { RUNNER_ONLINE_WINDOW_MS } from "@/lib/runner-constants";
import { parseSurvey, surveySummary, type Survey } from "@/lib/survey-core";
import { buildHomeMap, type Vantage } from "@/lib/homemap-core";

export const dynamic = "force-dynamic";

const IFACE_RE = /^[a-zA-Z0-9_.-]{1,32}$/;

// One accumulating record per owner: the walked vantages for the auto home map.
type StoredVantage = {
  id: string; // = the capture job id
  x: number;
  y: number;
  label: string;
  jobId: string; // "" once resolved
  capturedAt: number;
  survey?: Survey;
};

async function loadVantages(email: string): Promise<StoredVantage[]> {
  const row = await prisma.wifiSurvey.findUnique({ where: { ownerEmail: email } });
  if (!row?.data) return [];
  try {
    const parsed = JSON.parse(row.data);
    return Array.isArray(parsed?.vantages) ? (parsed.vantages as StoredVantage[]) : [];
  } catch {
    return [];
  }
}

async function saveVantages(email: string, vantages: StoredVantage[]): Promise<void> {
  const data = JSON.stringify({ vantages });
  await prisma.wifiSurvey.upsert({
    where: { ownerEmail: email },
    create: { ownerEmail: email, data },
    update: { data },
  });
}

/** Queue a monitor-mode survey at a walked spot (a "vantage"). */
export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const runnerId = String(body?.runnerId ?? "");
  const iface = String(body?.iface ?? "").trim();
  const x = Number(body?.x);
  const y = Number(body?.y);
  const label = String(body?.label ?? "").slice(0, 40);
  let seconds = Number(body?.seconds ?? 25);
  seconds = Math.max(8, Math.min(90, Math.round(Number.isFinite(seconds) ? seconds : 25)));

  if (!runnerId || !IFACE_RE.test(iface)) {
    return NextResponse.json({ error: "Pick a machine and a valid monitor adapter." }, { status: 400 });
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return NextResponse.json({ error: "Tap the plan to mark where you're standing." }, { status: 400 });
  }
  const runner = await prisma.runner.findUnique({ where: { id: runnerId }, select: { id: true, lastSeenAt: true } });
  if (!runner) return NextResponse.json({ error: "Machine not found." }, { status: 404 });
  const online = runner.lastSeenAt && Date.now() - new Date(runner.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS;
  if (!online) return NextResponse.json({ error: "That machine is offline." }, { status: 409 });

  const job = await prisma.job.create({
    data: {
      tool: "wifisurvey",
      target: iface,
      args: `${seconds} vantage=${label || "spot"}`,
      runnerId,
      status: "queued",
      priority: 5,
      queuedBy: email,
    },
    select: { id: true },
  });

  const vantages = await loadVantages(email);
  vantages.push({ id: job.id, x, y, label: label || `Spot ${vantages.length + 1}`, jobId: job.id, capturedAt: Date.now() });
  await saveVantages(email, vantages);

  return NextResponse.json({ jobId: job.id, vantageId: job.id, seconds });
}

/** Poll: resolve any finished captures, fuse everything into the home map. */
export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const vantages = await loadVantages(email);
  let changed = false;

  // Resolve any vantage still waiting on its capture job.
  const pendingIds = vantages.filter((v) => v.jobId && !v.survey).map((v) => v.jobId);
  if (pendingIds.length) {
    const jobs = await prisma.job.findMany({
      where: { id: { in: pendingIds } },
      select: { id: true, status: true, output: true },
    });
    const byId = new Map(jobs.map((j) => [j.id, j]));
    for (const v of vantages) {
      if (!v.jobId || v.survey) continue;
      const j = byId.get(v.jobId);
      if (!j) continue;
      if (j.status === "done") {
        v.survey = parseSurvey(j.output ?? "");
        v.jobId = "";
        changed = true;
      } else if (j.status === "error" || j.status === "canceled") {
        v.survey = { iface: "", aps: [], stations: [], error: j.status, message: `Capture ${j.status}.` };
        v.jobId = "";
        changed = true;
      }
    }
  }
  if (changed) await saveVantages(email, vantages);

  // Fuse only the vantages that produced a real (error-free) survey.
  const resolved: Vantage[] = vantages
    .filter((v) => v.survey && !v.survey.error && ((v.survey.aps?.length ?? 0) + (v.survey.stations?.length ?? 0)) > 0)
    .map((v) => ({ id: v.id, x: v.x, y: v.y, survey: v.survey as Survey }));
  const map = buildHomeMap(resolved);

  const status = vantages.map((v) => ({
    id: v.id,
    x: v.x,
    y: v.y,
    label: v.label,
    capturedAt: v.capturedAt,
    pending: !!v.jobId,
    error: v.survey?.error ? v.survey.message || v.survey.error : null,
    summary: v.survey && !v.survey.error ? surveySummary(v.survey) : null,
  }));

  return NextResponse.json({
    vantages: status,
    map,
    pending: vantages.some((v) => v.jobId),
  });
}

/** Clear the survey — start a fresh walk (optionally drop one vantage by id). */
export async function DELETE(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("vantage");
  if (id) {
    const vantages = (await loadVantages(email)).filter((v) => v.id !== id);
    await saveVantages(email, vantages);
    return NextResponse.json({ ok: true, remaining: vantages.length });
  }
  await saveVantages(email, []);
  return NextResponse.json({ ok: true, remaining: 0 });
}
