import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { RUNNER_ONLINE_WINDOW_MS } from "@/lib/runner-constants";
import { parseSurvey, surveySummary, type Survey } from "@/lib/survey-core";
import { buildHomeMap, type Vantage, type Pin } from "@/lib/homemap-core";

export const dynamic = "force-dynamic";

const IFACE_RE = /^[a-zA-Z0-9_.-]{1,32}$/;
const MAC_RE = /^[0-9A-Fa-f:]{17}$/;

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

type Store = { vantages: StoredVantage[]; pins: Pin[] };

async function loadStore(email: string): Promise<Store> {
  const row = await prisma.wifiSurvey.findUnique({ where: { ownerEmail: email } });
  if (!row?.data) return { vantages: [], pins: [] };
  try {
    const p = JSON.parse(row.data);
    return {
      vantages: Array.isArray(p?.vantages) ? (p.vantages as StoredVantage[]) : [],
      pins: Array.isArray(p?.pins) ? (p.pins as Pin[]) : [],
    };
  } catch {
    return { vantages: [], pins: [] };
  }
}

async function saveStore(email: string, store: Store): Promise<void> {
  const data = JSON.stringify(store);
  await prisma.wifiSurvey.upsert({
    where: { ownerEmail: email },
    create: { ownerEmail: email, data },
    update: { data },
  });
}

/** POST branches by body: {pin} adds a known-AP pin; {live:true} runs a one-off
 * monitor capture (not stored — for the live loop); otherwise queues a walked
 * vantage. */
export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  // --- Add / update a router pin (no capture). ---
  if (body?.pin) {
    const bssid = String(body.pin.bssid ?? "").toUpperCase();
    const px = Number(body.pin.x), py = Number(body.pin.y);
    if (!MAC_RE.test(bssid) || !Number.isFinite(px) || !Number.isFinite(py)) {
      return NextResponse.json({ error: "Pick an AP and a spot on the plan to pin it." }, { status: 400 });
    }
    const store = await loadStore(email);
    store.pins = store.pins.filter((p) => p.bssid.toUpperCase() !== bssid);
    store.pins.push({ bssid, x: Math.round(px * 10) / 10, y: Math.round(py * 10) / 10, label: String(body.pin.label ?? "").slice(0, 40) });
    await saveStore(email, store);
    return NextResponse.json({ ok: true, pins: store.pins.length });
  }

  const runnerId = String(body?.runnerId ?? "");
  const iface = String(body?.iface ?? "").trim();
  const live = !!body?.live;
  let seconds = Number(body?.seconds ?? (live ? 12 : 25));
  seconds = Math.max(8, Math.min(90, Math.round(Number.isFinite(seconds) ? seconds : 25)));

  if (!runnerId || !IFACE_RE.test(iface)) {
    return NextResponse.json({ error: "Pick a machine and a valid monitor adapter." }, { status: 400 });
  }
  const runner = await prisma.runner.findUnique({ where: { id: runnerId }, select: { id: true, lastSeenAt: true } });
  if (!runner) return NextResponse.json({ error: "Machine not found." }, { status: 404 });
  const online = runner.lastSeenAt && Date.now() - new Date(runner.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS;
  if (!online) return NextResponse.json({ error: "That machine is offline." }, { status: 409 });

  const job = await prisma.job.create({
    data: {
      tool: "wifisurvey",
      target: iface,
      args: `${seconds} vantage=${live ? "live" : "spot"}`,
      runnerId,
      status: "queued",
      priority: live ? 6 : 5, // live loop jumps ahead so it feels responsive
      queuedBy: email,
    },
    select: { id: true },
  });

  // Live captures aren't stored as vantages — the client reads them via ?job=.
  if (live) return NextResponse.json({ jobId: job.id, live: true, seconds });

  const x = Number(body?.x), y = Number(body?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return NextResponse.json({ error: "Tap the plan to mark where you're standing." }, { status: 400 });
  }
  const label = String(body?.label ?? "").slice(0, 40);
  const store = await loadStore(email);
  store.vantages.push({ id: job.id, x, y, label: label || `Spot ${store.vantages.length + 1}`, jobId: job.id, capturedAt: Date.now() });
  await saveStore(email, store);

  return NextResponse.json({ jobId: job.id, vantageId: job.id, seconds });
}

/** Poll: `?job=` returns one live capture; otherwise resolve finished vantage
 * captures and fuse everything (with pins) into the home map. */
export async function GET(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Live-loop single-capture read (not persisted).
  const jobParam = new URL(req.url).searchParams.get("job");
  if (jobParam) {
    const job = await prisma.job.findUnique({
      where: { id: jobParam },
      select: { status: true, output: true, tool: true, queuedBy: true },
    });
    if (!job || job.tool !== "wifisurvey" || job.queuedBy !== email) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    if (job.status === "done") return NextResponse.json({ status: "done", survey: parseSurvey(job.output ?? "") });
    if (job.status === "error" || job.status === "canceled") return NextResponse.json({ status: job.status });
    return NextResponse.json({ status: job.status });
  }

  const store = await loadStore(email);
  const vantages = store.vantages;
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
  if (changed) await saveStore(email, store);

  // Fuse only the vantages that produced a real (error-free) survey.
  const resolved: Vantage[] = vantages
    .filter((v) => v.survey && !v.survey.error && ((v.survey.aps?.length ?? 0) + (v.survey.stations?.length ?? 0)) > 0)
    .map((v) => ({ id: v.id, x: v.x, y: v.y, survey: v.survey as Survey }));
  const map = buildHomeMap(resolved, store.pins);

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
    pins: store.pins,
    map,
    pending: vantages.some((v) => v.jobId),
  });
}

/** Clear the survey — a vantage (?vantage=), a pin (?pin=), or everything. */
export async function DELETE(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const vantage = url.searchParams.get("vantage");
  const pin = url.searchParams.get("pin");
  const store = await loadStore(email);

  if (vantage) {
    store.vantages = store.vantages.filter((v) => v.id !== vantage);
    await saveStore(email, store);
    return NextResponse.json({ ok: true, remaining: store.vantages.length });
  }
  if (pin) {
    store.pins = store.pins.filter((p) => p.bssid.toUpperCase() !== pin.toUpperCase());
    await saveStore(email, store);
    return NextResponse.json({ ok: true, remaining: store.pins.length });
  }
  await saveStore(email, { vantages: [], pins: store.pins }); // keep pins on a walk reset
  return NextResponse.json({ ok: true, remaining: 0 });
}
