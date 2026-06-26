// Parse nmap normal output into a structured network map (multiple hosts, each
// with open ports/services). Pure + dependency-free — used both to render the
// network visualization and to generate per-host findings.

export type NetPort = {
  port: number;
  proto: string; // tcp | udp
  service: string;
  version: string;
};

export type NetworkHost = {
  host: string; // best label: hostname or ip
  ip: string | null;
  hostname: string | null;
  up: boolean;
  ports: NetPort[];
};

const IP_RE = /^[0-9a-fA-F:.]+$/;

function parseHostHeader(raw: string): { ip: string | null; hostname: string | null } {
  const s = raw.trim();
  // "hostname (1.2.3.4)"
  const m = /^(.+?)\s+\(([0-9a-fA-F:.]+)\)$/.exec(s);
  if (m) return { hostname: m[1].trim(), ip: m[2].trim() };
  // bare ip, or bare hostname
  if (IP_RE.test(s)) return { ip: s, hostname: null };
  return { ip: null, hostname: s };
}

/** Parse nmap normal output (single or multi-host) into hosts with open ports. */
export function parseNmapNetwork(output: string): NetworkHost[] {
  if (!output) return [];
  const hosts: NetworkHost[] = [];
  let current: NetworkHost | null = null;

  const portRe = /^(\d{1,5})\/(tcp|udp)\s+open\s+(\S+)(?:\s+(.*))?$/i;

  for (const raw of output.split("\n")) {
    const line = raw.trim();

    const reportMatch = /^Nmap scan report for\s+(.+)$/i.exec(line);
    if (reportMatch) {
      if (current) hosts.push(current);
      const { ip, hostname } = parseHostHeader(reportMatch[1]);
      current = {
        host: hostname || ip || reportMatch[1].trim(),
        ip,
        hostname,
        up: true, // assume up until "Host seems down" says otherwise
        ports: [],
      };
      continue;
    }
    if (!current) continue;

    if (/^Host seems down/i.test(line)) {
      current.up = false;
      continue;
    }

    const pm = portRe.exec(line);
    if (pm) {
      current.ports.push({
        port: Number(pm[1]),
        proto: pm[2].toLowerCase(),
        service: pm[3],
        version: (pm[4] ?? "").trim(),
      });
    }
  }
  if (current) hosts.push(current);

  // Keep hosts that are up or have ports (a ping sweep yields up hosts, 0 ports).
  return hosts.filter((h) => h.up || h.ports.length > 0);
}

/** Convenience: a one-line label for a host. */
export function hostLabel(h: NetworkHost): string {
  if (h.hostname && h.ip) return `${h.hostname} (${h.ip})`;
  return h.host;
}
