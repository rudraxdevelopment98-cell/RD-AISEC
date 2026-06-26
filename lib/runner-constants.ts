// Runner tool allowlist + job statuses. Separate module so the "use server"
// actions file can import these (a "use server" file may only export async
// functions).
//
// SECURITY: the portal only ever queues an allowlisted tool with one of its
// predefined argument presets. Targets and args are validated against
// SAFE_VALUE (no shell metacharacters) before a Job is created. The runner
// enforces its own copy of this allowlist as defense in depth — it never runs
// arbitrary shell.

export type ToolPreset = {
  id: string;
  label: string;
  // flags passed before the target, e.g. ["-sV", "-T4"]
  args: string[];
};

export type RunnerTool = {
  id: string;
  label: string;
  // short description of what it does, shown in the UI
  description: string;
  // whether this tool is active (touches the target) vs passive (lookup only)
  active: boolean;
  presets: ToolPreset[];
};

export const RUNNER_TOOLS: RunnerTool[] = [
  {
    id: "nmap",
    label: "Nmap — port & service scan",
    description: "Discover open ports and the services behind them.",
    active: true,
    // -Pn skips host discovery: most hosts block nmap's ping probes, which would
    // otherwise make nmap report "host seems down" and find 0 ports.
    presets: [
      { id: "quick", label: "Quick (top 100 ports)", args: ["-Pn", "-F", "-T4"] },
      { id: "service", label: "Service + version", args: ["-Pn", "-sV", "-T4"] },
      { id: "full", label: "Full TCP (all ports)", args: ["-Pn", "-p-", "-T4"] },
      {
        id: "discovery",
        label: "Network discovery (ping sweep — give a CIDR)",
        args: ["-sn", "-T4"],
      },
      {
        id: "network",
        label: "Network scan (top ports — give a CIDR)",
        args: ["-Pn", "-T4", "--top-ports", "100"],
      },
    ],
  },
  {
    id: "httpx",
    label: "httpx — HTTP probe",
    description: "Probe a host for live HTTP(S) services, titles and status.",
    active: true,
    presets: [
      { id: "probe", label: "Probe (title, status, tech)", args: ["-title", "-status-code", "-tech-detect"] },
    ],
  },
  {
    id: "nuclei",
    label: "Nuclei — templated checks",
    description: "Run community vulnerability/exposure templates against a target.",
    active: true,
    presets: [
      { id: "info", label: "Info & misconfig (low impact)", args: ["-severity", "info,low", "-jsonl"] },
      { id: "default", label: "Default templates", args: ["-jsonl"] },
    ],
  },
  {
    id: "whois",
    label: "WHOIS — registration lookup",
    description: "Passive registration/ownership lookup for a domain or IP.",
    active: false,
    presets: [{ id: "lookup", label: "Lookup", args: [] }],
  },
  {
    id: "dig",
    label: "dig — DNS records",
    description: "Passive DNS record lookup (A/AAAA/MX/NS/TXT).",
    active: false,
    presets: [{ id: "any", label: "Common records", args: ["+nocmd", "+noall", "+answer", "ANY"] }],
  },
  {
    id: "sqlmap",
    label: "sqlmap — SQL injection",
    description:
      "Test a URL's parameters for SQL injection (give a URL with a parameter, e.g. ?id=1).",
    active: true,
    presets: [
      { id: "detect", label: "Detect (params in URL)", args: ["--batch", "--level=1", "--risk=1"] },
      { id: "crawl", label: "Crawl + detect", args: ["--batch", "--crawl=1", "--level=1", "--risk=1"] },
      { id: "forms", label: "Test forms", args: ["--batch", "--forms", "--level=1", "--risk=1"] },
    ],
  },
  {
    id: "nikto",
    label: "Nikto — web server scan",
    description: "Scan a web server for known issues, outdated software, and misconfigurations.",
    active: true,
    presets: [{ id: "scan", label: "Default scan", args: [] }],
  },
  {
    id: "wpscan",
    label: "WPScan — WordPress",
    description: "Enumerate a WordPress site for version, plugins, and known vulnerabilities.",
    active: true,
    presets: [
      { id: "scan", label: "Scan", args: ["--no-banner", "--random-user-agent"] },
      {
        id: "enumerate",
        label: "Enumerate vulnerable plugins",
        args: ["--no-banner", "--random-user-agent", "--enumerate", "vp"],
      },
    ],
  },
  {
    id: "sslscan",
    label: "sslscan — TLS/SSL",
    description: "Check a host's TLS/SSL configuration, protocols, ciphers, and certificate.",
    active: true,
    presets: [{ id: "scan", label: "Scan (host[:port])", args: [] }],
  },
  {
    id: "arpscan",
    label: "arp-scan — LAN device discovery",
    description:
      "Find live hosts on a local subnet at layer 2 (IP + MAC + vendor). Give a CIDR. Needs the runner to run as root.",
    active: true,
    presets: [{ id: "scan", label: "Scan subnet (give a CIDR)", args: [] }],
  },
  {
    id: "masscan",
    label: "masscan — fast port scan",
    description:
      "Very fast TCP port scanner across a host or CIDR. Needs the runner to run as root.",
    active: true,
    presets: [
      { id: "top", label: "Top 1000 ports", args: ["-p1-1000", "--rate", "1000"] },
      { id: "web", label: "Web ports", args: ["-p80,443,8080,8443", "--rate", "1000"] },
    ],
  },
  {
    id: "gobuster",
    label: "gobuster — content discovery",
    description: "Brute-force directories and files on a web server using a wordlist.",
    active: true,
    presets: [
      {
        id: "common",
        label: "Common paths (dirb common.txt)",
        args: ["dir", "-q", "-w", "/usr/share/wordlists/dirb/common.txt"],
      },
      {
        id: "big",
        label: "Bigger list (dirbuster medium)",
        args: ["dir", "-q", "-w", "/usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt"],
      },
    ],
  },
  {
    id: "whatweb",
    label: "WhatWeb — tech fingerprint",
    description: "Identify the technologies, CMS, server, and frameworks a website runs.",
    active: true,
    presets: [
      { id: "scan", label: "Fingerprint", args: [] },
      { id: "aggressive", label: "Aggressive (level 3)", args: ["-a", "3"] },
    ],
  },
  {
    id: "wafw00f",
    label: "wafw00f — WAF detection",
    description: "Detect whether a site sits behind a web application firewall, and which one.",
    active: true,
    presets: [{ id: "detect", label: "Detect WAF", args: [] }],
  },
  {
    id: "dnsrecon",
    label: "dnsrecon — DNS enumeration",
    description: "Enumerate DNS records and attempt a zone transfer for a domain.",
    active: true,
    presets: [{ id: "std", label: "Standard records", args: [] }],
  },
  {
    id: "dnsenum",
    label: "dnsenum — DNS + subdomains",
    description: "Enumerate DNS info and brute-force subdomains for a domain.",
    active: true,
    presets: [{ id: "scan", label: "Enumerate", args: ["--noreverse"] }],
  },
  {
    id: "amass",
    label: "Amass — subdomain discovery",
    description: "Discover subdomains for a domain via public OSINT sources (passive).",
    active: false,
    presets: [{ id: "passive", label: "Passive enum", args: ["enum", "-passive"] }],
  },
  {
    id: "theharvester",
    label: "theHarvester — OSINT",
    description: "Gather emails, hosts, and subdomains for a domain from public sources.",
    active: false,
    presets: [{ id: "scan", label: "Search (DuckDuckGo)", args: ["-b", "duckduckgo"] }],
  },
  {
    id: "enum4linux",
    label: "enum4linux — SMB/Windows enum",
    description: "Enumerate shares, users, and groups from a Windows/Samba host (give an IP).",
    active: true,
    presets: [{ id: "all", label: "Full enumeration", args: ["-a"] }],
  },
  {
    id: "searchsploit",
    label: "searchsploit — Exploit-DB search",
    description:
      "Search the local Exploit-DB for known exploits matching a product/version (offline lookup).",
    active: false,
    presets: [{ id: "search", label: "Search term", args: [] }],
  },
];

export function findTool(id: string): RunnerTool | undefined {
  return RUNNER_TOOLS.find((t) => t.id === id);
}

/**
 * Execution spec the runner needs per tool: the binary to run and the flag that
 * carries the target (null = host-based, appended positionally with the scheme
 * stripped). Served to runners by /api/runner/tools so adding a tool here makes
 * it work on every runner WITHOUT re-pulling the runner script (the binary must
 * still be installed on the runner). Keep `flag: null` exactly for the tools in
 * HOST_TARGET_TOOLS below.
 */
export const RUNNER_TOOL_SPECS: Record<string, { bin: string; flag: string | null }> = {
  nmap: { bin: "nmap", flag: null },
  httpx: { bin: "httpx", flag: "-u" },
  nuclei: { bin: "nuclei", flag: "-u" },
  whois: { bin: "whois", flag: null },
  dig: { bin: "dig", flag: null },
  sqlmap: { bin: "sqlmap", flag: "-u" },
  nikto: { bin: "nikto", flag: "-h" },
  wpscan: { bin: "wpscan", flag: "--url" },
  sslscan: { bin: "sslscan", flag: null },
  arpscan: { bin: "arp-scan", flag: null },
  masscan: { bin: "masscan", flag: null },
  gobuster: { bin: "gobuster", flag: "-u" },
  whatweb: { bin: "whatweb", flag: null },
  wafw00f: { bin: "wafw00f", flag: null },
  dnsrecon: { bin: "dnsrecon", flag: "-d" },
  dnsenum: { bin: "dnsenum", flag: null },
  amass: { bin: "amass", flag: "-d" },
  theharvester: { bin: "theHarvester", flag: "-d" },
  enum4linux: { bin: "enum4linux", flag: null },
  searchsploit: { bin: "searchsploit", flag: null },
};

// Tools we can install from the portal, mapped to their apt package. Only these
// (a fixed list — never arbitrary names) can be requested for install. httpx and
// nuclei aren't apt packages (ProjectDiscovery) so they're installed manually.
export const INSTALLABLE_PKGS: Record<string, string> = {
  nmap: "nmap",
  whois: "whois",
  dig: "dnsutils",
  sqlmap: "sqlmap",
  nikto: "nikto",
  wpscan: "wpscan",
  sslscan: "sslscan",
  nuclei: "nuclei", // Kali packages nuclei in apt
  arpscan: "arp-scan",
  masscan: "masscan",
  gobuster: "gobuster",
  whatweb: "whatweb",
  wafw00f: "wafw00f",
  dnsrecon: "dnsrecon",
  dnsenum: "dnsenum",
  amass: "amass",
  theharvester: "theharvester",
  enum4linux: "enum4linux",
  searchsploit: "exploitdb",
  metasploit: "metasploit-framework", // for the Exploitation section (no auto-find tool)
  tor: "tor", // for anonymity
  torsocks: "torsocks", // for anonymity
};

/** Serialize the tool specs for the runner (incl. apt package for installs). */
export function runnerToolSpecs(): {
  id: string;
  bin: string;
  flag: string | null;
  pkg: string | null;
}[] {
  return RUNNER_TOOLS.filter((t) => RUNNER_TOOL_SPECS[t.id]).map((t) => ({
    id: t.id,
    bin: RUNNER_TOOL_SPECS[t.id].bin,
    flag: RUNNER_TOOL_SPECS[t.id].flag,
    pkg: INSTALLABLE_PKGS[t.id] ?? null,
  }));
}

// Tools that scan a host/IP (not a URL). These can't parse a "https://" scheme
// or a path, so we strip the target down to its hostname for them. The URL-based
// tools (httpx/nuclei/sqlmap/nikto/wpscan) keep the full URL.
const HOST_TARGET_TOOLS = new Set([
  "nmap",
  "whois",
  "dig",
  "sslscan",
  "arpscan",
  "masscan",
  "whatweb",
  "wafw00f",
  "dnsrecon",
  "dnsenum",
  "amass",
  "theharvester",
  "enum4linux",
  "searchsploit",
]);

/** Normalize a target for a given tool (strip scheme/path for host-based tools). */
export function normalizeTarget(toolId: string, raw: string): string {
  let t = raw.trim();
  if (HOST_TARGET_TOOLS.has(toolId)) {
    t = t.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""); // strip scheme
    t = t.split("/")[0]; // strip path
  }
  return t;
}

export const JOB_STATUSES = [
  "queued",
  "running",
  "done",
  "failed",
  "canceled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

// Current runner script version. Bump when rdaisec_runner.py changes in a way
// that benefits from a re-pull; the Runners page flags runners reporting an
// older version. (The tool list itself is now server-driven, so most additions
// no longer need a bump.)
export const RUNNER_VERSION = "16";

// A runner is considered offline if it hasn't polled within this window.
export const RUNNER_ONLINE_WINDOW_MS = 90_000;

// A job stuck in "running" longer than this is treated as dead (runner crashed,
// lost connection, or the tool hung) and auto-failed. Must exceed the runner's
// per-job timeout (JOB_TIMEOUT, default 900s) with margin.
export const JOB_STALE_MS = 20 * 60_000;

// Cap stored tool output so a chatty tool can't bloat the database.
export const MAX_OUTPUT_CHARS = 200_000;

/**
 * Allowed characters for a target or an arg token. Deliberately strict — no
 * shell metacharacters (; | & $ ` > < ( ) etc.), so even though the runner uses
 * argv (not a shell), a malformed value can never become an injection.
 */
const SAFE_VALUE = /^[A-Za-z0-9 ._:/@,+=\-]+$/;

export function isSafeValue(v: string): boolean {
  return v.length > 0 && v.length <= 512 && SAFE_VALUE.test(v);
}

/**
 * URL targets (sqlmap/nikto/wpscan/httpx/nuclei) need query-string characters
 * like ? & = # %. We allow the RFC 3986 reserved+unreserved set but still reject
 * spaces, quotes, backticks, and a leading "-" (so a target can't be read as a
 * flag). Execution is via argv (never a shell), so these characters can't inject.
 */
const SAFE_URL = /^[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/;

export function isSafeUrl(v: string): boolean {
  return v.length > 0 && v.length <= 1024 && !v.startsWith("-") && SAFE_URL.test(v);
}

/** Validate a (normalized) target for a tool: URL rules for URL tools, host rules otherwise. */
export function validateTarget(toolId: string, target: string): boolean {
  return HOST_TARGET_TOOLS.has(toolId) ? isSafeValue(target) : isSafeUrl(target);
}
