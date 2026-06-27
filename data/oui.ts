// Offline MAC → vendor lookup (curated OUI prefixes for common consumer/IoT/
// network gear). Not exhaustive — enough to label devices as a phone, computer,
// IoT thing, or network gear. Keys are uppercase "AA:BB:CC".

const OUI: Record<string, string> = {
  // Apple
  "3C:06:30": "Apple", "F0:18:98": "Apple", "A4:83:E7": "Apple", "DC:A9:04": "Apple",
  "AC:DE:48": "Apple", "F4:0F:24": "Apple", "90:72:40": "Apple", "BC:52:B7": "Apple",
  "00:1C:B3": "Apple", "D0:81:7A": "Apple",
  // Samsung
  "5C:0A:5B": "Samsung", "E8:50:8B": "Samsung", "F0:25:B7": "Samsung", "BC:14:85": "Samsung",
  "C8:19:F7": "Samsung", "94:35:0A": "Samsung", "8C:77:12": "Samsung",
  // Google / Nest
  "F4:F5:E8": "Google", "1C:F2:9A": "Google", "A4:77:33": "Google", "94:EB:2C": "Google Nest",
  "DA:A1:19": "Google",
  // Amazon (Echo/Fire/Ring)
  "FC:65:DE": "Amazon", "44:65:0D": "Amazon", "68:37:E9": "Amazon", "F0:81:73": "Amazon",
  "B0:7F:B9": "Amazon Ring",
  // Xiaomi / Huawei / OnePlus / Oppo
  "64:09:80": "Xiaomi", "28:6C:07": "Xiaomi", "F8:A4:5F": "Xiaomi",
  "00:E0:FC": "Huawei", "48:46:FB": "Huawei", "AC:E2:15": "Huawei",
  "94:65:2D": "OnePlus", "C0:EE:FB": "OnePlus",
  // Intel / Microsoft / Dell / HP / Lenovo (computers)
  "00:1B:21": "Intel", "3C:97:0E": "Intel", "A0:88:69": "Intel", "94:C6:91": "Intel",
  "00:15:5D": "Microsoft (Hyper-V)", "00:50:F2": "Microsoft", "C8:3F:26": "Microsoft",
  "18:03:73": "Dell", "F8:BC:12": "Dell", "00:14:22": "Dell",
  "3C:D9:2B": "HP", "70:5A:0F": "HP", "A0:48:1C": "HP",
  "54:E1:AD": "Lenovo", "8C:16:45": "Lenovo",
  // IoT chipsets
  "5C:CF:7F": "Espressif (ESP IoT)", "24:0A:C4": "Espressif (ESP IoT)", "A4:CF:12": "Espressif (ESP IoT)",
  "B4:E6:2D": "Espressif (ESP IoT)", "EC:FA:BC": "Espressif (ESP IoT)",
  "B8:27:EB": "Raspberry Pi", "DC:A6:32": "Raspberry Pi", "E4:5F:01": "Raspberry Pi",
  "00:0E:58": "Sonos", "94:9F:3E": "Sonos", "5C:AA:FD": "Sonos",
  "D0:73:D5": "LIFX (IoT)", "10:27:F5": "Tuya (IoT)",
  // Network gear
  "00:1A:2B": "Cisco", "00:25:9C": "Cisco", "F4:CF:E2": "Cisco",
  "50:C7:BF": "TP-Link", "EC:08:6B": "TP-Link", "A4:2B:B0": "TP-Link",
  "20:E5:2A": "Netgear", "9C:3D:CF": "Netgear", "C0:3F:0E": "Netgear",
  "44:D9:E7": "Ubiquiti", "FC:EC:DA": "Ubiquiti", "78:8A:20": "Ubiquiti",
  "D8:FB:5E": "Aruba", "00:0B:86": "Aruba",
  "C8:3A:35": "Tenda", "00:1F:33": "Netgear",
  // Sony / LG / Roku / smart TV
  "FC:F1:52": "Sony", "00:24:BE": "Sony", "AC:9B:0A": "LG", "00:1C:62": "LG",
  "B0:A7:37": "Roku", "CC:6D:A0": "Roku", "DC:3A:5E": "Roku",
};

const PHONE = /apple|samsung|xiaomi|huawei|oneplus|oppo|google\b/i;
const COMPUTER = /intel|dell|^hp\b|hp$|lenovo|microsoft/i;
const IOT = /espressif|raspberry|sonos|lifx|tuya|kasa|ring|nest|amazon|roku|sony|^lg\b|lg$/i;
const NETGEAR = /cisco|tp-link|netgear|ubiquiti|aruba|tenda/i;

/** Vendor for a MAC (best-effort). Flags randomized/private MACs. */
export function lookupVendor(mac: string): string {
  const m = (mac || "").toUpperCase();
  const prefix = m.slice(0, 8);
  if (!/^([0-9A-F]{2}:){2}[0-9A-F]{2}$/.test(prefix)) return "";
  // Locally-administered bit (private/randomized MAC) — common on modern phones.
  const first = parseInt(m.slice(0, 2), 16);
  if (!Number.isNaN(first) && (first & 0x02)) return "Randomized (private)";
  return OUI[prefix] ?? "Unknown";
}

/** A rough device-type emoji+label from the vendor. */
export function deviceType(vendor: string): string {
  if (!vendor || vendor === "Unknown") return "";
  if (/randomized/i.test(vendor)) return "📱 likely phone";
  if (PHONE.test(vendor)) return "📱 phone/tablet";
  if (COMPUTER.test(vendor)) return "💻 computer";
  if (NETGEAR.test(vendor)) return "📡 network gear";
  if (IOT.test(vendor)) return "🔌 IoT/smart";
  return "";
}
