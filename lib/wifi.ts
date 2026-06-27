"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

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
