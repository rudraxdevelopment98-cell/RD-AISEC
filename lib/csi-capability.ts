// Can this device do CSI? CSI extraction depends on the RECEIVER's WiFi chipset
// + firmware/driver toolchain — NOT the access point. Any AP works as the
// transmitter; what matters is the card doing the measuring. This maps a
// chipset/driver string to an honest verdict. Pure, unit tested.

export type CsiVerdict = {
  supported: boolean;
  tool: string; // the toolchain that unlocks CSI on this chip
  antennas: number; // RX chains (→ whether angle-of-arrival is possible)
  note: string;
};

type Entry = { re: RegExp; v: CsiVerdict };

// Ordered most-specific first.
const TABLE: Entry[] = [
  {
    re: /\b(5300|iwl5000|ultimate-n 5300)\b/i,
    v: { supported: true, tool: "Linux 802.11n CSI Tool (Halperin)", antennas: 3, note: "The classic CSI card — 3 antennas → angle-of-arrival. Needs an old kernel + the patched iwlwifi." },
  },
  {
    re: /\b(ax210|ax211|ax200|ax201|ax211|be200)\b/i,
    v: { supported: true, tool: "PicoScenes", antennas: 2, note: "Modern Intel — CSI via PicoScenes (recommended). AX210 supports 2 spatial streams." },
  },
  {
    re: /\b(9300|qca9300|ar9300|ar9580|ar9590|ar9344|qca9558)\b/i,
    v: { supported: true, tool: "Atheros-CSI-Tool / PicoScenes", antennas: 3, note: "Atheros ath9k CSI-capable family — good multi-antenna CSI." },
  },
  {
    re: /\b(ar9271|ath9k_htc)\b/i,
    v: { supported: false, tool: "—", antennas: 1, note: "AR9271 (e.g. TL-WN721N) is single-antenna USB with no CSI firmware. Great for monitor-mode/attacks, not CSI. Use an ESP32-CSI node instead." },
  },
  {
    re: /\b(bcm43455|bcm4358|bcm4366|bcm4339|nexmon)\b/i,
    v: { supported: true, tool: "nexmon_csi", antennas: 1, note: "Broadcom (Raspberry Pi 3B+/4 bcm43455) — CSI via nexmon_csi. Single antenna → motion/vitals, no AoA." },
  },
  {
    re: /\b(esp32|esp32-s3|esp8266)\b/i,
    v: { supported: true, tool: "ESP32-CSI-Tool", antennas: 1, note: "Cheapest dedicated CSI node. Stream CSI over serial/UDP into the collector. A few of them form the mapping mesh." },
  },
  {
    re: /\b(intel|iwlwifi|7260|8260|9560|3160|3165|3168)\b/i,
    v: { supported: false, tool: "—", antennas: 2, note: "Most other Intel cards (7260/8260/9560…) don't expose CSI. If it's actually an AX200/AX210, PicoScenes works." },
  },
  {
    re: /\b(realtek|rtl8|8188|8812|8821)\b/i,
    v: { supported: false, tool: "—", antennas: 1, note: "Realtek cards have no maintained CSI toolchain. Use an ESP32-CSI node or an Intel AX210." },
  },
  {
    re: /\b(mediatek|mt76|mt7921|mt7615)\b/i,
    v: { supported: false, tool: "—", antennas: 2, note: "MediaTek CSI is experimental at best. Prefer ESP32-CSI or Intel AX210." },
  },
];

/** Map a chipset/driver string (e.g. "AX210", "iwlwifi", "AR9271") to a verdict. */
export function csiCapability(chipsetOrDriver: string): CsiVerdict {
  const s = chipsetOrDriver || "";
  for (const e of TABLE) if (e.re.test(s)) return e.v;
  return {
    supported: false,
    tool: "—",
    antennas: 1,
    note: "Unknown chipset. Find it with `lspci -k | grep -A3 -i net` or `ethtool -i wlan0` (driver), then re-check. If it isn't Intel 5300/AX200-AX210, Atheros ath9k, or Broadcom/nexmon, add an ESP32-CSI node.",
  };
}

/** The pickable chipsets for the in-app checker. */
export const CSI_CHIPSETS: { id: string; label: string }[] = [
  { id: "ax210", label: "Intel AX200 / AX210 (modern laptop)" },
  { id: "5300", label: "Intel 5300 (classic CSI card)" },
  { id: "ar9271", label: "Atheros AR9271 (TL-WN721N USB)" },
  { id: "qca9300", label: "Atheros AR9300/QCA9300 family" },
  { id: "bcm43455", label: "Broadcom bcm43455 (Raspberry Pi)" },
  { id: "esp32", label: "ESP32 / ESP32-S3 node" },
  { id: "realtek", label: "Realtek (RTL8xxx)" },
  { id: "mediatek", label: "MediaTek (MT76xx)" },
  { id: "other", label: "Other / not sure" },
];
