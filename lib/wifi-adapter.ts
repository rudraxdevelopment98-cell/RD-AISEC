// WiFi adapter capability brain — "detect the device, then give custom options".
//
// Given a chipset/driver string reported by the capture node, this returns what
// the adapter can actually do: monitor mode, injection, CSI, bands, antennas,
// and the role it should play (capture / host-only / csi-node). AirSight's whole
// customization layer keys off this — the UI only offers options the hardware
// supports. Pure (no DB/IO), unit tested. For authorized use only.

export type Band = "2.4" | "5" | "6";
export type AdapterRole = "capture" | "host-only" | "csi-node";

export type AdapterCapability = {
  /** Human name of the matched family. */
  family: string;
  monitor: boolean; // monitor mode (passive capture)
  injection: boolean; // frame injection (active — gated)
  csi: boolean; // Channel State Information extraction
  csiTool: string; // toolchain that unlocks CSI, or ""
  bands: Band[];
  antennas: number;
  role: AdapterRole;
  note: string;
};

type Entry = { re: RegExp; cap: Omit<AdapterCapability, "family">; family: string };

// Ordered most-specific first.
const ADAPTERS: Entry[] = [
  {
    family: "Atheros AR9271 (ath9k_htc)",
    re: /\b(ar9271|ath9k_htc|tl-?wn722n?|tl-?wn721n?)\b/i,
    cap: { monitor: true, injection: true, csi: false, csiTool: "", bands: ["2.4"], antennas: 1, role: "capture", note: "Classic monitor-mode/injection USB (TL-WN721N/722N). 2.4 GHz, single antenna, no CSI. Ideal AirSight capture node." },
  },
  {
    family: "Realtek RTL8812AU/8811AU",
    re: /\b(rtl88(12|11)a?u|8812au|8811au|rtl8812)\b/i,
    cap: { monitor: true, injection: true, csi: false, csiTool: "", bands: ["2.4", "5"], antennas: 2, role: "capture", note: "Dual-band monitor/injection (needs the aircrack-ng 8812au DKMS driver). Great capture node with 5 GHz." },
  },
  {
    family: "Realtek RTL8188/8187",
    re: /\b(rtl818[78]|8188eus?|rtl8192)\b/i,
    cap: { monitor: true, injection: true, csi: false, csiTool: "", bands: ["2.4"], antennas: 1, role: "capture", note: "2.4 GHz monitor/injection. No CSI." },
  },
  {
    family: "MediaTek MT7612U / MT76",
    re: /\b(mt7612u?|mt76|mt7601u?|mt7921)\b/i,
    cap: { monitor: true, injection: true, csi: false, csiTool: "", bands: ["2.4", "5"], antennas: 2, role: "capture", note: "Dual-band monitor/injection with the in-kernel mt76 driver. Solid capture node." },
  },
  {
    family: "Atheros AR9300/QCA9300",
    re: /\b(ar9300|qca9300|ar9380|ath9k\b)\b/i,
    cap: { monitor: true, injection: true, csi: true, csiTool: "Atheros-CSI-Tool", bands: ["2.4", "5"], antennas: 3, role: "capture", note: "Rare combo: monitor/injection AND CSI (3 antennas → angle-of-arrival)." },
  },
  {
    family: "Intel 5300 (iwlwifi)",
    re: /\b(5300|iwl5000|ultimate-?n 5300)\b/i,
    cap: { monitor: false, injection: false, csi: true, csiTool: "Linux 802.11n CSI Tool", bands: ["2.4", "5"], antennas: 3, role: "csi-node", note: "The classic CSI card (3 antennas → AoA). Poor monitor mode; use it as a CSI node, not a capture node." },
  },
  {
    family: "Intel AX200/AX210 (iwlwifi)",
    re: /\b(ax200|ax201|ax210|ax211|be200)\b/i,
    cap: { monitor: false, injection: false, csi: true, csiTool: "PicoScenes", bands: ["2.4", "5", "6"], antennas: 2, role: "csi-node", note: "Modern Intel — CSI via PicoScenes. Monitor mode is unreliable on Linux; best as a CSI node." },
  },
  {
    family: "Broadcom bcm43455 (nexmon)",
    re: /\b(bcm43455|brcmfmac|cyw43455|raspberr)\b/i,
    cap: { monitor: true, injection: false, csi: true, csiTool: "nexmon_csi", bands: ["2.4", "5"], antennas: 1, role: "csi-node", note: "Raspberry Pi 3B+/4 — monitor + CSI via nexmon. Single antenna (motion/vitals, no AoA)." },
  },
  {
    family: "ESP32 / ESP32-S3",
    re: /\b(esp32|esp8266)\b/i,
    cap: { monitor: false, injection: false, csi: true, csiTool: "ESP32-CSI-Tool", bands: ["2.4"], antennas: 1, role: "csi-node", note: "Cheap dedicated CSI node over serial/UDP. A few form the sensing mesh." },
  },
  {
    family: "Apple Silicon WiFi (BCM4387)",
    re: /\b(apple|m1|m2|m3|m4|bcm4387|bcm4378|macbook|silicon)\b/i,
    cap: { monitor: false, injection: false, csi: false, csiTool: "", bands: ["2.4", "5", "6"], antennas: 2, role: "host-only", note: "Apple's closed WiFi — no monitor mode, no CSI. Use the Mac as the HOST/dashboard; capture on a Kali VM + USB adapter." },
  },
  {
    family: "Generic Intel (no CSI)",
    re: /\b(iwlwifi|intel|7260|8260|9560|3165|3168)\b/i,
    cap: { monitor: false, injection: false, csi: false, csiTool: "", bands: ["2.4", "5"], antennas: 2, role: "host-only", note: "Most built-in Intel cards: managed only, no monitor, no CSI. Host/dashboard role." },
  },
];

const UNKNOWN: AdapterCapability = {
  family: "Unknown adapter",
  monitor: false, injection: false, csi: false, csiTool: "",
  bands: ["2.4"], antennas: 1, role: "host-only",
  note: "Chipset not recognised. Find it with `lsusb`, `lspci -k | grep -A3 -i net`, or `ethtool -i <iface>` and re-check. Most USB adapters with an Atheros/Realtek/MediaTek chip can do monitor-mode capture.",
};

/** Map a chipset/driver string (e.g. "AR9271", "rtl8812au", "AX210") to caps. */
export function adapterCapability(chipsetOrDriver: string): AdapterCapability {
  const s = chipsetOrDriver || "";
  for (const e of ADAPTERS) if (e.re.test(s)) return { family: e.family, ...e.cap };
  return UNKNOWN;
}

/** Can this adapter be a passive AirSight capture node (monitor mode)? */
export function canCapture(chipsetOrDriver: string): boolean {
  return adapterCapability(chipsetOrDriver).monitor;
}
