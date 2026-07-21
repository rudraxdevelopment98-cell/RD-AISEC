// Server-side helpers for authenticating a Runner by its bearer token.
// Not a "use server" module — imported by API route handlers.
import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { parseMaintHeader, isActiveStage } from "@/lib/maintenance-core";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Stamp a runner update, retrying a couple of times on a transient DB blip. The
 * heartbeat's lastSeenAt write is what keeps a machine "online"; on Vercel+Neon a
 * single pooled-connection hiccup (or a free-tier cold start) used to silently
 * drop that write — the runner still got its 204 and thought it was fine, while
 * the portal flipped it offline for no visible reason. A short retry absorbs those
 * blips so a healthy machine stops flapping. Never throws.
 */
async function stampRunner(id: string, data: Record<string, unknown>): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await prisma.runner.update({ where: { id }, data });
      return true;
    } catch {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 120 * (attempt + 1)));
    }
  }
  return false;
}

type Runner = NonNullable<Awaited<ReturnType<typeof prisma.runner.findUnique>>>;

/**
 * Resolve "Authorization: Bearer <token>" to a Runner. READ-ONLY — this used to
 * also do a ~20-column telemetry write on every request, which coupled auth to a
 * heavy DB write and was the root cause of machines flapping "offline" when that
 * write contended or hit a Neon blip. Presence and telemetry are now separate,
 * explicit calls (touchPresence / recordTelemetry). Returns the runner or null.
 */
export async function authenticateRunner(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return null;
  const token = m[1].trim();
  if (!token) return null;
  return prisma.runner.findUnique({ where: { tokenHash: hashToken(token) } });
}

/** Parse the cheap version + maintenance-stage headers into an update patch. */
function versionMaintPatch(req: Request, runner: Runner): Record<string, unknown> {
  const version = (req.headers.get("x-runner-version") ?? "").slice(0, 20);
  const patch: Record<string, unknown> = version ? { version } : {};
  const maint = parseMaintHeader(req.headers.get("x-runner-maint"));
  if (maint) {
    patch.maintStage = maint.stage;
    patch.maintNote = maint.note;
    patch.maintPct = maint.pct;
    patch.maintUpdatedAt = new Date();
    const wasActive = isActiveStage((runner.maintStage as never) ?? "idle");
    if (isActiveStage(maint.stage) && !wasActive) patch.maintStartedAt = new Date();
  }
  return patch;
}

/**
 * LIGHT presence stamp — lastSeenAt (+ cheap version/maint). This is what keeps a
 * machine "online" while it's busy on a long job (via the heartbeat ping) and at
 * the head of the SSE stream. Retried against transient Neon blips; never throws.
 */
export async function touchPresence(runner: Runner, req: Request): Promise<void> {
  await stampRunner(runner.id, { lastSeenAt: new Date(), ...versionMaintPatch(req, runner) });
}

/**
 * FULL telemetry write — lastSeenAt + the ~20 machine-stat columns from X-Runner-*
 * headers. Called explicitly by the endpoints that actually carry telemetry (the
 * job poll, the job result, and ping?full=1), NOT on every authenticated request.
 * Best-effort: on a heavy-write failure it still stamps a minimal lastSeenAt so a
 * slow stats write can never flip a healthy machine offline.
 */
export async function recordTelemetry(runner: Runner, req: Request): Promise<void> {
  const maintData = versionMaintPatch(req, runner);
  // The runner reports its loaded-tool count via headers on each poll.
  const toolsHeader = req.headers.get("x-runner-tools") ?? "";
  const toolCount = toolsHeader
    ? toolsHeader.split(",").map((t) => t.trim()).filter(Boolean).length
    : runner.toolCount;
  // Tor exit IP it reports while anonymity is on (only persist when anonymity is on).
  const exitHeader = (req.headers.get("x-runner-exit-ip") ?? "").slice(0, 64);
  const exitIp = runner.anonymity ? exitHeader : "";
  // Reported Tor state: off | connecting | on | no-tor.
  const anonStatus = (req.headers.get("x-runner-anon-status") ?? "").slice(0, 20);
  // Local subnets the runner detected (for one-click "scan this network").
  const subnets = (req.headers.get("x-runner-subnets") ?? "").slice(0, 512);
  // Wireless interfaces + monitor-mode capability (for WiFi).
  const wifi = (req.headers.get("x-runner-wifi") ?? "").slice(0, 256);
  const wifiMonitor = (req.headers.get("x-runner-wifi-monitor") ?? "") === "1";
  // Per-adapter chipset/driver detail ("iface:driver,…") for device-aware options.
  const wifiDetail = (req.headers.get("x-runner-wifi-detail") ?? "").slice(0, 512);
  // Which allowlisted tools actually have a binary present on the runner.
  const installed = (req.headers.get("x-runner-installed") ?? "").slice(0, 512);
  // Live machine stats for the footer monitor (0..100; temp in °C). Absent on
  // older runners → leave the stored value untouched.
  const pct = (h: string): number | undefined => {
    const v = req.headers.get(h);
    if (v == null || v === "") return undefined;
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : undefined;
  };
  const cpuPct = pct("x-runner-cpu");
  const memPct = pct("x-runner-mem");
  const tempRaw = req.headers.get("x-runner-temp");
  const tempC = tempRaw ? Math.round(Number(tempRaw)) : undefined;
  const loadAvg = (req.headers.get("x-runner-load") ?? "").slice(0, 40);
  // Absolute resource figures (MB / cores / seconds).
  const intH = (h: string): number | undefined => {
    const v = req.headers.get(h);
    if (v == null || v === "") return undefined;
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const memUsedMb = intH("x-runner-mem-used");
  const memTotalMb = intH("x-runner-mem-total");
  const diskUsedMb = intH("x-runner-disk-used");
  const diskTotalMb = intH("x-runner-disk-total");
  const cores = intH("x-runner-cores");
  const uptimeSec = intH("x-runner-uptime");
  const gpuPct = pct("x-runner-gpu");
  const batteryPct = pct("x-runner-battery");
  const powerW = intH("x-runner-power");
  const chargingH = req.headers.get("x-runner-charging");
  const charging = chargingH == null || chargingH === "" ? undefined : chargingH === "1";

  await prisma.runner
    .update({
      where: { id: runner.id },
      data: {
        lastSeenAt: new Date(),
        ...maintData,
        toolCount,
        ...(runner.anonymity ? { exitIp } : {}),
        ...(anonStatus ? { anonStatus } : {}),
        ...(subnets ? { subnets } : {}),
        wifi,
        wifiMonitor,
        ...(wifiDetail ? { wifiDetail } : {}),
        // Only update the installed-tools list when the runner actually reported
        // one. An EMPTY header must never overwrite a good list — during a runner
        // restart (e.g. self-update) there's a brief window before its telemetry
        // cache primes where it sends "", and blindly writing that blanked the
        // field, making every tool show "uninstalled" until the next good write.
        ...(installed ? { installed } : {}),
        ...(cpuPct !== undefined ? { cpuPct } : {}),
        ...(memPct !== undefined ? { memPct } : {}),
        ...(tempC !== undefined && Number.isFinite(tempC) ? { tempC } : {}),
        ...(loadAvg ? { loadAvg } : {}),
        ...(memUsedMb !== undefined ? { memUsedMb } : {}),
        ...(memTotalMb !== undefined ? { memTotalMb } : {}),
        ...(diskUsedMb !== undefined ? { diskUsedMb } : {}),
        ...(diskTotalMb !== undefined ? { diskTotalMb } : {}),
        ...(cores !== undefined ? { cores } : {}),
        ...(uptimeSec !== undefined ? { uptimeSec } : {}),
        ...(gpuPct !== undefined ? { gpuPct } : {}),
        ...(batteryPct !== undefined ? { batteryPct } : {}),
        ...(powerW !== undefined ? { powerW } : {}),
        ...(charging !== undefined ? { charging } : {}),
      },
    })
    .catch(async () => {
      // The heavy ~20-field stats write can contend/time out under load or a Neon
      // blip. If it fails, still keep the machine ONLINE with a minimal lastSeenAt
      // stamp — a slow stats write must never be what flips a healthy box offline.
      await stampRunner(runner.id, { lastSeenAt: new Date() });
    });
}
