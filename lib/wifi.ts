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
