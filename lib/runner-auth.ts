// Server-side helpers for authenticating a Runner by its bearer token.
// Not a "use server" module — imported by API route handlers.
import { createHash } from "crypto";
import { prisma } from "@/lib/db";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Read "Authorization: Bearer <token>" from the request, resolve the runner,
 * and stamp lastSeenAt. Returns the runner or null if the token is missing/bad.
 */
export async function authenticateRunner(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return null;
  const token = m[1].trim();
  if (!token) return null;

  const runner = await prisma.runner.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!runner) return null;

  // The runner reports its version + loaded-tool count via headers on each poll.
  const version = (req.headers.get("x-runner-version") ?? "").slice(0, 20);
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

  await prisma.runner
    .update({
      where: { id: runner.id },
      data: {
        lastSeenAt: new Date(),
        ...(version ? { version } : {}),
        toolCount,
        ...(runner.anonymity ? { exitIp } : {}),
        ...(anonStatus ? { anonStatus } : {}),
        ...(subnets ? { subnets } : {}),
        wifi,
        wifiMonitor,
        installed,
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
      },
    })
    .catch(() => {});
  return runner;
}
