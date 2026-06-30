// IoT / connected-device assessment — pure, no DB/IO. Consumes the parsed
// network hosts (lib/network NetworkHost) from an nmap scan and:
//   • classifies each device (camera, router, printer, NAS, smart-home, …)
//   • emits IoT-specific vulnerability findings (exposed telnet/RTSP/UPnP/MQTT,
//     default-credential-prone admin panels, plaintext protocols, …)
//   • attaches concrete hardening advice + an exploitation/validation hint
// Findings are hypotheses ("reported" confidence) until the exploit engine
// proves them. For authorized testing of devices you own/are permitted to test.

import type { NetworkHost } from "./network";

export type IotSeverity = "low" | "medium" | "high" | "critical";
const SEV_RANK: Record<IotSeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export type DeviceType =
  | "ip-camera"
  | "router/gateway"
  | "printer"
  | "nas/storage"
  | "smart-home/hub"
  | "media/tv"
  | "voip"
  | "generic-iot"
  | "host";

export type DeviceClass = { type: DeviceType; signals: string[] };

export type IotFinding = {
  check: string; // e.g. "IOT-telnet"
  severity: IotSeverity;
  host: string;
  title: string;
  description: string;
  recommendation: string; // hardening advice
  validateWith: string; // how to prove/exploit it (authorized)
};

function portSet(h: NetworkHost): Set<number> {
  return new Set(h.ports.filter((p) => p.proto !== "udp" || true).map((p) => p.port));
}
function svcText(h: NetworkHost): string {
  return [h.hostname ?? "", ...h.ports.map((p) => `${p.service} ${p.version}`)].join(" ").toLowerCase();
}

// --- device classification ---------------------------------------------------
export function classifyDevice(h: NetworkHost): DeviceClass {
  const ports = portSet(h);
  const t = svcText(h);
  const has = (...ps: number[]) => ps.some((p) => ports.has(p));
  const name = (h.hostname ?? "").toLowerCase();

  const signals: string[] = [];
  const sig = (s: string) => signals.push(s);

  if (has(554, 8554, 37777, 34567) || /rtsp|dahua|hikvision|\bipc\b|\bcam\b|onvif|axis-/i.test(t)) {
    if (has(554, 8554)) sig("RTSP (554)");
    if (has(37777)) sig("Dahua (37777)");
    if (has(34567)) sig("XiongMai/Sofia (34567)");
    if (/cam|ipc|dahua|hikvision|onvif|axis/i.test(t)) sig("camera vendor/banner");
    return { type: "ip-camera", signals };
  }
  if (has(9100, 631, 515) || /jetdirect|printer|ipp\b|cups/i.test(t)) {
    if (has(9100)) sig("raw printing (9100)");
    if (has(631)) sig("IPP (631)");
    if (has(515)) sig("LPD (515)");
    return { type: "printer", signals };
  }
  if (has(5000, 5001, 548) && /synology|qnap|nas|diskstation|truenas|netatalk|afp/i.test(t) || /synology|qnap|truenas|diskstation/i.test(name)) {
    sig("NAS service/banner");
    return { type: "nas/storage", signals };
  }
  if (has(1883, 8883, 5683) || /mqtt|coap|mosquitto|zigbee|z-wave|hubitat|smartthings/i.test(t)) {
    if (has(1883)) sig("MQTT (1883)");
    if (has(8883)) sig("MQTT/TLS (8883)");
    if (has(5683)) sig("CoAP (5683)");
    return { type: "smart-home/hub", signals };
  }
  // Media/TV needs a real cast signal — UPnP alone is NOT a TV (routers run it too).
  if (has(8008, 8009, 7000) || /chromecast|airplay|roku|\bdlna\b|smarttv|tizen|webos/i.test(t)) {
    sig("media/cast service");
    return { type: "media/tv", signals };
  }
  if (has(5060, 5061) || /sip|asterisk|voip|grandstream|polycom/i.test(t)) {
    sig("SIP/VoIP");
    return { type: "voip", signals };
  }
  if (has(53) && has(80, 443) || /router|gateway|openwrt|dd-wrt|mikrotik|tp-link|netgear|asuswrt|dlink/i.test(t) || /router|gateway|gw\b/i.test(name)) {
    if (has(53)) sig("DNS (53)");
    if (has(1900)) sig("UPnP (1900)");
    sig("router/gateway banner");
    return { type: "router/gateway", signals };
  }
  if (has(23, 2323) || /busybox|embedded|telnet|realtek|broadcom/i.test(t)) {
    sig("embedded/telnet");
    return { type: "generic-iot", signals };
  }
  return { type: "host", signals: [] };
}

// --- IoT vulnerability findings + hardening ----------------------------------
export function iotFindings(h: NetworkHost): IotFinding[] {
  const ports = portSet(h);
  const t = svcText(h);
  const host = h.host;
  const cls = classifyDevice(h);
  const out: IotFinding[] = [];
  const has = (...ps: number[]) => ps.some((p) => ports.has(p));
  const iotish = cls.type !== "host";

  if (has(23, 2323)) {
    out.push({
      check: "IOT-telnet",
      severity: "critical",
      host,
      title: `Telnet exposed on ${host}`,
      description:
        "Telnet is plaintext and a primary target of IoT botnets (Mirai and variants brute-force default Telnet credentials). An exposed Telnet service on an embedded device is one of the highest-risk findings.",
      recommendation:
        "Disable Telnet entirely; use SSH if remote management is needed. Change all default credentials and block port 23/2323 at the gateway. Put IoT devices on an isolated VLAN/SSID.",
      validateWith: "Try the device's known default Telnet credentials (authorized only); confirm a shell/banner.",
    });
  }
  if (cls.type === "ip-camera" && has(554, 8554)) {
    out.push({
      check: "IOT-rtsp",
      severity: "high",
      host,
      title: `RTSP camera stream on ${host}`,
      description:
        "An RTSP service often serves the live video stream. Many cameras allow anonymous viewing or ship default credentials, exposing the feed to anyone on the network.",
      recommendation:
        "Require a strong password on the stream, disable anonymous/ONVIF guest access, update firmware, and isolate cameras on a dedicated VLAN with no internet egress.",
      validateWith: "Probe common RTSP paths with ffprobe/`nmap --script rtsp-url-brute`; confirm a stream without auth.",
    });
  }
  if (has(1883)) {
    out.push({
      check: "IOT-mqtt",
      severity: "high",
      host,
      title: `Unencrypted MQTT broker on ${host}`,
      description:
        "MQTT on 1883 is plaintext. If it allows anonymous connections, anyone on the network can subscribe to '#' and read every topic (sensor data, commands) or publish forged control messages.",
      recommendation:
        "Require authentication, enable TLS (8883), set per-topic ACLs, and disable anonymous access. Don't expose the broker beyond the device segment.",
      validateWith: "`mosquitto_sub -h <host> -t '#' -C 1` (authorized) — confirm anonymous topic access.",
    });
  }
  if (has(1900, 49152, 49153, 49154) || /upnp/i.test(t)) {
    out.push({
      check: "IOT-upnp",
      severity: "medium",
      host,
      title: `UPnP/SSDP exposed on ${host}`,
      description:
        "UPnP lets devices auto-open ports and describe internal services. Exposed UPnP has enabled NAT-injection, internal service disclosure, and reflection/amplification abuse.",
      recommendation:
        "Disable UPnP on the router/gateway unless strictly required; if needed, restrict it to trusted segments and keep firmware current.",
      validateWith: "Enumerate with `upnpc -l` / nmap `upnp-info`; review exposed actions and port mappings.",
    });
  }
  if (has(5683)) {
    out.push({
      check: "IOT-coap",
      severity: "medium",
      host,
      title: `CoAP service on ${host}`,
      description:
        "CoAP (5683/udp) is common on constrained IoT devices and is frequently unauthenticated; it can also be abused for amplification.",
      recommendation: "Require DTLS, authenticate requests, and rate-limit; don't expose CoAP outside the device segment.",
      validateWith: "`coap-client -m get coap://<host>/.well-known/core` — enumerate resources without auth.",
    });
  }
  // Embedded web admin panel that tends to ship default creds.
  if ((cls.type === "ip-camera" || cls.type === "router/gateway" || cls.type === "printer" || cls.type === "nas/storage") && has(80, 443, 8080, 8443)) {
    out.push({
      check: "IOT-default-creds",
      severity: "high",
      host,
      title: `Default-credential-prone admin panel on ${host} (${cls.type})`,
      description:
        `A web admin interface is exposed on a ${cls.type}. Embedded devices very often ship with documented default credentials (admin/admin, admin/<vendor>, etc.) that are never changed.`,
      recommendation:
        "Change default credentials immediately, enforce a strong unique password, disable remote/WAN admin, enable HTTPS, and apply firmware updates. Restrict the admin UI to a management VLAN.",
      validateWith: "Try the vendor's documented default logins (authorized); nuclei `default-login` templates against the panel.",
    });
  }
  if (has(9100)) {
    out.push({
      check: "IOT-printer-raw",
      severity: "medium",
      host,
      title: `Raw printing port open on ${host}`,
      description:
        "Port 9100 (JetDirect) accepts raw print jobs and PJL/PostScript commands. It can be abused to read/alter printer settings, capture jobs, or cause denial of service.",
      recommendation:
        "Restrict 9100 to print servers, disable unused protocols (FTP/Telnet/SNMP-public) on the printer, set an admin password, and update firmware.",
      validateWith: "PRET (`printer exploitation toolkit`) against the device to enumerate capabilities (authorized).",
    });
  }
  // Plaintext management protocols generally bad on IoT.
  if (has(21) && iotish) {
    out.push({
      check: "IOT-ftp",
      severity: "medium",
      host,
      title: `Plaintext FTP on ${host}`,
      description: "FTP transmits credentials and data in cleartext and is often enabled by default on IoT firmware with weak/default logins.",
      recommendation: "Disable FTP (use SFTP if needed), change defaults, and segment the device.",
      validateWith: "Test anonymous/default FTP login (authorized).",
    });
  }
  if (has(161) && iotish) {
    out.push({
      check: "IOT-snmp",
      severity: "medium",
      host,
      title: `SNMP exposed on ${host}`,
      description: "SNMP with the default 'public' community string leaks device configuration and can sometimes be written to.",
      recommendation: "Disable SNMP or set a non-default community / SNMPv3 with auth+priv; block 161/udp at the gateway.",
      validateWith: "`snmpwalk -v2c -c public <host>` — confirm the default community works.",
    });
  }

  return out.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);
}

/** Assess a whole network's hosts: classified inventory + all IoT findings. */
export function assessNetwork(hosts: NetworkHost[]): {
  inventory: { host: string; type: DeviceType; signals: string[]; openPorts: number }[];
  findings: IotFinding[];
} {
  const inventory = hosts.map((h) => {
    const c = classifyDevice(h);
    return { host: h.host, type: c.type, signals: c.signals, openPorts: h.ports.length };
  });
  const findings = hosts.flatMap(iotFindings).sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);
  return { inventory, findings };
}
