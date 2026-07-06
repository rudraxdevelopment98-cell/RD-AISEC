// Pure helpers for the monitor-mode RF survey (the "wherever signal reaches"
// map). Parses the runner's wifisurvey JSON, turns RSSI into distance, resolves
// vendor from the OUI, and classifies devices. No DB/IO — unit-testable.
//
// Physics: RSSI → distance uses log-distance path loss, d = 10^((Tx - RSSI)/10n).
// It's an ESTIMATE (indoor multipath makes it noisy) — good to a couple of
// metres, not survey-grade. Bearing needs multiple vantages (see homemap-core).
// Authorized spaces only.

export type SurveyAp = {
  bssid: string;
  channel: number;
  privacy: string; // "WPA2", "OPN", …
  cipher: string;
  auth: string;
  power: number; // RSSI dBm (negative; 0/-1 = unknown)
  beacons: number;
  essid: string;
  firstSeen?: string;
  lastSeen?: string;
};

export type SurveyStation = {
  mac: string;
  power: number; // RSSI dBm
  packets: number;
  bssid: string; // associated AP, "" if not associated
  probes: string;
  firstSeen?: string;
  lastSeen?: string;
};

export type Survey = {
  iface: string;
  mon?: string;
  vantage?: string;
  durationSec?: number;
  aps: SurveyAp[];
  stations: SurveyStation[];
  error?: string;
  message?: string;
};

/** Parse the runner's wifisurvey JSON output into a typed Survey (tolerant). */
export function parseSurvey(output: string): Survey {
  let o: Record<string, unknown> = {};
  try {
    o = JSON.parse(output || "{}");
  } catch {
    return { iface: "", aps: [], stations: [], error: "parse", message: "Unreadable survey output." };
  }
  const aps = Array.isArray(o.aps) ? (o.aps as SurveyAp[]) : [];
  const stations = Array.isArray(o.stations) ? (o.stations as SurveyStation[]) : [];
  return {
    iface: String(o.iface ?? ""),
    mon: o.mon ? String(o.mon) : undefined,
    vantage: o.vantage ? String(o.vantage) : undefined,
    durationSec: typeof o.durationSec === "number" ? o.durationSec : undefined,
    aps,
    stations,
    error: o.error ? String(o.error) : undefined,
    message: o.message ? String(o.message) : undefined,
  };
}

export type PathLossOpts = { txPowerDbm?: number; pathLossN?: number };

/** RSSI (dBm) → distance (m) via log-distance path loss. Returns null if RSSI is
 * missing/invalid (airodump reports 0 or -1 when it hasn't measured power). */
export function rssiToMeters(rssi: number, opts: PathLossOpts = {}): number | null {
  if (!Number.isFinite(rssi) || rssi >= 0 || rssi < -100) return null;
  const tx = opts.txPowerDbm ?? -40; // dBm at 1 m (typical indoor AP)
  const n = opts.pathLossN ?? 3.0; // indoor exponent (walls/furniture)
  const d = Math.pow(10, (tx - rssi) / (10 * n));
  return Math.round(Math.min(60, Math.max(0.3, d)) * 10) / 10;
}

/** A coarse 0–100 "signal bars" value from RSSI, for display. */
export function rssiBars(rssi: number): number {
  if (!Number.isFinite(rssi) || rssi >= 0) return 0;
  // -30 (excellent) → 100, -90 (unusable) → 0.
  return Math.round(Math.max(0, Math.min(100, ((rssi + 90) / 60) * 100)));
}

// A small, high-hit-rate OUI → vendor table (first 3 MAC octets). Not exhaustive
// — covers the brands you actually see at home; anything else falls back to the
// raw OUI. Kept deliberately compact (bundle size) but easy to extend.
const OUI: Record<string, string> = {
  // Apple
  "3C:06:30": "Apple", "F0:18:98": "Apple", "A4:83:E7": "Apple", "AC:BC:32": "Apple",
  "D0:81:7A": "Apple", "F4:F1:5A": "Apple", "88:66:5A": "Apple", "DC:2B:2A": "Apple",
  "F0:99:BF": "Apple", "34:C0:59": "Apple", "A8:5C:2C": "Apple", "90:9C:4A": "Apple",
  // Samsung
  "5C:0A:5B": "Samsung", "E8:50:8B": "Samsung", "84:25:DB": "Samsung", "F0:25:B7": "Samsung",
  "C8:BA:94": "Samsung", "34:14:5F": "Samsung", "8C:77:12": "Samsung",
  // Google / Nest
  "F4:F5:D8": "Google", "F8:8F:CA": "Google", "3C:5A:B4": "Google", "DA:A1:19": "Google",
  // Amazon (Echo/Fire)
  "44:65:0D": "Amazon", "68:37:E9": "Amazon", "FC:65:DE": "Amazon", "0C:47:C9": "Amazon",
  "50:DC:E7": "Amazon", "A0:02:DC": "Amazon",
  // Xiaomi
  "64:09:80": "Xiaomi", "78:11:DC": "Xiaomi", "F8:A4:5F": "Xiaomi", "50:8F:4C": "Xiaomi",
  // Intel (laptops)
  "34:41:5D": "Intel", "94:65:9C": "Intel", "7C:B0:C2": "Intel", "A0:C5:89": "Intel",
  "50:E0:85": "Intel", "8C:F8:C5": "Intel",
  // Router / AP vendors
  "50:C7:BF": "TP-Link", "A4:2B:B0": "TP-Link", "AC:84:C6": "TP-Link", "C0:06:C3": "TP-Link",
  "98:DA:C4": "TP-Link", "60:32:B1": "TP-Link",
  "2C:30:33": "Netgear", "A0:40:A0": "Netgear", "9C:3D:CF": "Netgear",
  "F4:92:BF": "Cisco", "00:1A:2B": "Cisco",
  "B0:39:56": "Netgear",
  "DC:A6:32": "Raspberry Pi", "B8:27:EB": "Raspberry Pi", "E4:5F:01": "Raspberry Pi",
  "00:1D:D8": "Microsoft", "50:1A:C5": "Microsoft",
  "18:B4:30": "Nest", "64:16:66": "Nest",
  "EC:FA:BC": "Espressif (ESP)", "24:0A:C4": "Espressif (ESP)", "A4:CF:12": "Espressif (ESP)",
  "7C:DF:A1": "Espressif (ESP)", "30:AE:A4": "Espressif (ESP)",
  "D8:0D:17": "TP-Link", "1C:61:B4": "TP-Link",
};

/** Resolve a MAC/BSSID to a vendor via its OUI, or "" if unknown/random. */
export function vendorForMac(mac: string): string {
  const m = (mac || "").toUpperCase();
  const oui = m.slice(0, 8);
  if (OUI[oui]) return OUI[oui];
  // Locally-administered (randomized) MAC: 2nd hex nibble has bit 1 set.
  const second = parseInt(m[1], 16);
  if (Number.isFinite(second) && (second & 0x2) !== 0) return "randomized";
  return "";
}

export type DeviceKind = "router" | "phone" | "laptop" | "iot" | "computer" | "unknown";

/** Best-effort device class from vendor + role. Honest: it's a heuristic. */
export function deviceKind(vendor: string, isAp: boolean, probes?: string): DeviceKind {
  const v = vendor.toLowerCase();
  if (isAp) {
    if (/tp-link|netgear|cisco|asus|linksys|d-link/.test(v)) return "router";
    if (/nest|google|amazon|espressif|xiaomi/.test(v)) return "iot";
    return "router";
  }
  if (/apple|samsung|xiaomi/.test(v)) return probes && probes.length > 40 ? "phone" : "phone";
  if (/intel|microsoft/.test(v)) return "laptop";
  if (/espressif|raspberry|nest|amazon|google/.test(v)) return "iot";
  return "unknown";
}

/** Human summary counts for the survey. */
export function surveySummary(s: Survey): {
  aps: number;
  stations: number;
  named: number;
  open: number;
  strongest: number | null;
} {
  const named = s.aps.filter((a) => a.essid && a.essid.trim()).length;
  const open = s.aps.filter((a) => /opn|open/i.test(a.privacy) || !a.privacy.trim()).length;
  const powers = [...s.aps, ...s.stations].map((d) => d.power).filter((p) => p < 0);
  const strongest = powers.length ? Math.max(...powers) : null;
  return { aps: s.aps.length, stations: s.stations.length, named, open, strongest };
}
