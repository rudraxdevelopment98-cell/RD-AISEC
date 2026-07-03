// Engagement data map — pure graph builder (no DB/IO, unit-testable).
//
// Turns an engagement's real data (findings, jobs, programs, people) into a
// typed node/edge graph the canvas renders: engagement → hosts/servers →
// subdomains + services, the important findings, the bug-bounty programs, and
// the collaborators who ran the work. Clicking a node opens its detail tabs.
//
// This is DISTINCT from the local Network Map (lib/network.ts), which is only
// live LAN host discovery. This one is the engagement's whole picture.

export type GNodeType =
  | "engagement"
  | "host"
  | "subdomain"
  | "finding"
  | "program"
  | "person";

export type GFinding = {
  id: string;
  title: string;
  severity: string;
  status: string;
  confirmed: boolean;
};

export type GNode = {
  id: string;
  type: GNodeType;
  label: string;
  sub?: string;
  severity?: string; // worst severity (host rollup / finding)
  meta?: Record<string, string | number>;
  findings?: GFinding[]; // host: its findings (for the popup "Findings" tab)
  services?: string[]; // host: open ports/services
};

export type GEdge = { from: string; to: string; kind?: string };

export type EngagementGraph = { nodes: GNode[]; edges: GEdge[] };

const SEV_RANK: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
function worse(a: string, b: string): string {
  return (SEV_RANK[b] ?? 0) > (SEV_RANK[a] ?? 0) ? b : a;
}

/** Pull a bare host/IP out of a URL or a finding title's "… on <host>" tail. */
export function hostOf(text: string): string {
  if (!text) return "";
  // "… on host.com" / "… on 1.2.3.4:443"
  const onm = text.match(/\bon\s+((?:[a-z0-9_-]+\.)+[a-z]{2,}|(?:\d{1,3}\.){3}\d{1,3})/i);
  if (onm) return clean(onm[1]);
  // A URL anywhere in the string.
  const url = text.match(/https?:\/\/([^/\s:]+)/i);
  if (url) return clean(url[1]);
  // A bare domain/IP token.
  const bare = text.match(/\b((?:[a-z0-9_-]+\.)+[a-z]{2,}|(?:\d{1,3}\.){3}\d{1,3})\b/i);
  return bare ? clean(bare[1]) : "";
}

function clean(h: string): string {
  return h.toLowerCase().replace(/^www\./, "").replace(/[:/].*$/, "").trim();
}

function isIp(h: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(h);
}
function apexOf(h: string): string {
  if (isIp(h)) return h;
  const parts = h.split(".");
  return parts.length >= 2 ? parts.slice(-2).join(".") : h;
}

type Input = {
  engagement: {
    id: string;
    name: string;
    client?: string;
    type?: string;
    status?: string;
    scope?: string;
    ownerEmail?: string;
    sourceRepo?: string;
  };
  findings: {
    id: string;
    title: string;
    severity: string;
    status: string;
    confirmed: boolean;
    description?: string | null;
  }[];
  jobs?: { tool: string; target: string; status?: string; queuedBy?: string | null }[];
  programs?: { id: string; name: string }[];
};

const MAX_HOSTS = 120;
const MAX_FINDING_NODES = 60;
const MAX_SUBDOMAINS = 80;

/**
 * Build the engagement graph. Hosts are the backbone; subdomains hang off their
 * apex; important findings (confirmed / high / critical) get their own node, the
 * rest roll up onto the host. Programs and people link to the engagement root.
 */
export function buildEngagementGraph(input: Input): EngagementGraph {
  const { engagement: e, findings, jobs = [], programs = [] } = input;
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const seen = new Set<string>();
  const add = (n: GNode) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    nodes.push(n);
  };
  const link = (from: string, to: string, kind?: string) => edges.push({ from, to, kind });

  // Root.
  const root = "eng";
  add({
    id: root,
    type: "engagement",
    label: e.name,
    sub: e.client || e.type || "engagement",
    meta: {
      client: e.client || "—",
      type: e.type || "—",
      status: e.status || "—",
      scope: (e.scope || "—").slice(0, 200),
    },
  });

  // Collect hosts from findings + job targets.
  const hostFindings = new Map<string, GFinding[]>();
  const hostServices = new Map<string, Set<string>>();
  const ensureHost = (h: string) => {
    if (!hostFindings.has(h)) hostFindings.set(h, []);
    if (!hostServices.has(h)) hostServices.set(h, new Set());
  };

  for (const f of findings) {
    const h = hostOf(f.title) || hostOf(f.description ?? "");
    const gf: GFinding = {
      id: f.id,
      title: f.title,
      severity: f.severity,
      status: f.status,
      confirmed: f.confirmed,
    };
    if (h) {
      ensureHost(h);
      hostFindings.get(h)!.push(gf);
      // Open ports become services on the host.
      const port = f.title.match(/\bport\s+(\d{1,5})(?:\/(tcp|udp))?/i);
      if (port) hostServices.get(h)!.add(`${port[1]}/${(port[2] || "tcp").toLowerCase()}`);
    } else {
      // Host-less finding — attach directly to the engagement as a finding node.
      if (nodes.filter((n) => n.type === "finding").length < MAX_FINDING_NODES && important(gf)) {
        add({ id: `f:${f.id}`, type: "finding", label: shorten(f.title), severity: f.severity, sub: f.severity });
        link(`f:${f.id}`, root, "finding");
      }
    }
  }
  for (const j of jobs) {
    const h = hostOf(j.target);
    if (h) ensureHost(h);
  }

  // Emit host nodes (apex first so subdomains can link to them).
  const hosts = [...hostFindings.keys()].slice(0, MAX_HOSTS);
  const apexes = new Set(hosts.filter((h) => apexOf(h) === h));
  // Ensure apex nodes exist for subdomains even if the apex itself had no finding.
  for (const h of hosts) apexes.add(apexOf(h));

  let subCount = 0;
  const emitted = new Set<string>();
  const emitHost = (h: string) => {
    if (emitted.has(h)) return;
    emitted.add(h);
    const fs = hostFindings.get(h) ?? [];
    const rollup = fs.reduce((s, f) => worse(s, f.severity), "info");
    const svc = [...(hostServices.get(h) ?? [])].sort();
    const apex = apexOf(h);
    const isSub = h !== apex;
    add({
      id: `h:${h}`,
      type: isSub ? "subdomain" : "host",
      label: h,
      sub: isIp(h) ? "server / IP" : isSub ? "subdomain" : "host",
      severity: fs.length ? rollup : undefined,
      services: svc,
      findings: fs,
      meta: {
        findings: fs.length,
        services: svc.length,
        worst: fs.length ? rollup : "none",
      },
    });
    if (isSub) {
      // Link to its apex if we have one, else to the engagement.
      if (apexes.has(apex) && apex !== h) {
        emitHost(apex);
        link(`h:${h}`, `h:${apex}`, "subdomain-of");
      } else {
        link(`h:${h}`, root, "host");
      }
    } else {
      link(`h:${h}`, root, "host");
    }
  };
  // Apexes first, then the rest.
  for (const h of hosts) if (apexOf(h) === h) emitHost(h);
  for (const h of hosts) {
    if (apexOf(h) !== h) {
      if (subCount >= MAX_SUBDOMAINS) break;
      subCount++;
      emitHost(h);
    }
  }

  // Important findings get their own node hanging off the host, so they're
  // visible at a glance (the rest live in the host's Findings tab).
  let fnodes = nodes.filter((n) => n.type === "finding").length;
  for (const [h, fs] of hostFindings) {
    if (!emitted.has(h)) continue;
    for (const f of fs) {
      if (fnodes >= MAX_FINDING_NODES) break;
      if (!important(f)) continue;
      add({ id: `f:${f.id}`, type: "finding", label: shorten(f.title), severity: f.severity, sub: f.severity });
      link(`f:${f.id}`, `h:${h}`, "finding");
      fnodes++;
    }
  }

  // Programs.
  for (const p of programs) {
    add({ id: `p:${p.id}`, type: "program", label: p.name, sub: "bug-bounty program" });
    link(`p:${p.id}`, root, "program");
  }

  // People / collaboration — owner + whoever queued jobs.
  const people = new Set<string>();
  if (e.ownerEmail) people.add(e.ownerEmail);
  for (const j of jobs) if (j.queuedBy) people.add(j.queuedBy);
  for (const person of [...people].slice(0, 20)) {
    add({ id: `u:${person}`, type: "person", label: person.split("@")[0], sub: person });
    link(`u:${person}`, root, "collaborator");
  }

  return { nodes, edges };
}

function important(f: GFinding): boolean {
  return f.confirmed || f.severity === "high" || f.severity === "critical";
}
function shorten(s: string): string {
  return s.length > 40 ? s.slice(0, 39) + "…" : s;
}
