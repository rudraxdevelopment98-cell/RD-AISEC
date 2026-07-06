// Parse a LAN discovery scan (nmap -sn or arp-scan) into a device list — the
// honest answer to "what's actually on my WiFi", separate from motion sensing.
// Pure (no DB/IO), unit tested. Vendor/type via the OUI table.

import { lookupVendor, deviceType } from "@/data/oui";

export type Device = {
  ip: string;
  mac: string; // "" if unknown (nmap without root)
  vendor: string;
  type: string;
};

const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const MAC_RE = /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/i;

/** Parse nmap `-sn` and/or arp-scan output into a de-duplicated device list. */
export function parseDevices(output: string): Device[] {
  const byIp = new Map<string, Device>();
  const upsert = (ip: string, mac: string, vendorHint: string) => {
    if (!ip) return;
    const cur = byIp.get(ip) ?? { ip, mac: "", vendor: "", type: "" };
    if (mac && !cur.mac) cur.mac = mac.toLowerCase();
    const vendor = vendorHint || (cur.mac ? lookupVendor(cur.mac) : "") || cur.vendor;
    cur.vendor = vendor;
    cur.type = deviceType(vendor);
    byIp.set(ip, cur);
  };

  const lines = (output || "").split(/\r?\n/);
  let pendingIp = "";
  for (const line of lines) {
    // nmap: "Nmap scan report for 192.168.1.5" or "... for host (192.168.1.5)"
    const nmapReport = /Nmap scan report for\s+(.+)/i.exec(line);
    if (nmapReport) {
      const ip = nmapReport[1].match(IP_RE)?.[0] ?? "";
      if (ip) { pendingIp = ip; upsert(ip, "", ""); }
      continue;
    }
    // nmap: "MAC Address: AA:BB:CC:DD:EE:FF (Vendor Name)"
    const nmapMac = /MAC Address:\s*([0-9a-f:.-]{11,})\s*(?:\(([^)]*)\))?/i.exec(line);
    if (nmapMac && pendingIp) {
      upsert(pendingIp, nmapMac[1], (nmapMac[2] ?? "").trim());
      continue;
    }
    // arp-scan: "192.168.1.1<TAB>aa:bb:cc:dd:ee:ff<TAB>Vendor Name"
    const ip = line.match(IP_RE)?.[0];
    const mac = line.match(MAC_RE)?.[0];
    if (ip && mac) {
      const vendor = line.split(/\t|\s{2,}/).slice(2).join(" ").trim();
      upsert(ip, mac, vendor);
      pendingIp = ip;
    }
  }
  return Array.from(byIp.values()).sort((a, b) => cmpIp(a.ip, b.ip));
}

function cmpIp(a: string, b: string): number {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 4; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

/** Roll up a device list into counts by type — for the "who's on the WiFi" tile. */
export function deviceSummary(devices: Device[]): { total: number; byType: { type: string; count: number }[] } {
  const m = new Map<string, number>();
  for (const d of devices) m.set(d.type || "device", (m.get(d.type || "device") ?? 0) + 1);
  return {
    total: devices.length,
    byType: Array.from(m.entries()).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
  };
}
