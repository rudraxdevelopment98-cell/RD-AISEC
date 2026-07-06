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
      { id: "quick", label: "Quick (top 100 ports)", args: ["-Pn", "-F", "-T4", "--host-timeout", "10m"] },
      { id: "service", label: "Service + version", args: ["-Pn", "-sV", "-T4", "--host-timeout", "20m"] },
      { id: "full", label: "Full TCP (all ports)", args: ["-Pn", "-p-", "-T4", "--host-timeout", "30m", "--min-rate", "800"] },
      {
        id: "discovery",
        label: "Network discovery (ping sweep — give a CIDR)",
        args: ["-sn", "-T4"],
      },
      {
        id: "network",
        label: "Network scan (top ports — give a CIDR)",
        args: ["-Pn", "-T4", "--top-ports", "100", "--host-timeout", "10m"],
      },
      {
        id: "iot",
        label: "IoT device sweep (cameras/printers/hubs — give a CIDR)",
        // The IoT-relevant ports: telnet(23/2323), ftp/ssh/snmp, web admin
        // (80/443/8080/8443), RTSP(554/8554), printers(515/631/9100), NAS
        // (445/548/5000/5001), MQTT(1883/8883), CoAP(5683), UPnP(1900/49152),
        // SIP(5060), Dahua/XiongMai(37777/34567), cast(8008/8009). -sV so the
        // parser can classify each device and raise IoT-specific findings.
        args: [
          "-Pn", "-sV", "-T4", "--host-timeout", "15m",
          "-p", "21,22,23,53,80,161,443,515,548,554,631,1883,1900,2323,5000,5001,5060,5683,8008,8009,8080,8443,8554,8883,9100,34567,37777,49152",
        ],
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
      { id: "info", label: "Info & misconfig (low impact)", args: ["-severity", "info,low", "-jsonl", "-rl", "150", "-timeout", "8", "-retries", "1"] },
      { id: "default", label: "Default templates", args: ["-jsonl", "-rl", "150", "-timeout", "8", "-retries", "1", "-c", "50"] },
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
    id: "subfinder",
    label: "subfinder — fast subdomain discovery",
    description: "Find subdomains for a domain from many passive sources (fast, OSINT).",
    active: false,
    presets: [{ id: "passive", label: "Passive enum", args: ["-silent"] }],
  },
  {
    id: "naabu",
    label: "naabu — fast port scan",
    description: "Very fast SYN/CONNECT port scan (ProjectDiscovery). Give a host/IP.",
    active: true,
    presets: [
      { id: "top", label: "Top 100 ports", args: ["-silent", "-top-ports", "100"] },
      { id: "web", label: "Web ports", args: ["-silent", "-p", "80,443,8080,8443"] },
    ],
  },
  {
    id: "katana",
    label: "katana — web crawler",
    description: "Crawl a web app to map its URLs/endpoints (feeds deeper testing).",
    active: true,
    presets: [
      { id: "crawl", label: "Crawl (depth 2)", args: ["-silent", "-d", "2"] },
      { id: "jscrawl", label: "Crawl + JS parsing", args: ["-silent", "-d", "3", "-jc"] },
    ],
  },
  {
    id: "dalfox",
    label: "dalfox — XSS scanner",
    description: "Test a URL (with parameters) for cross-site scripting (XSS).",
    active: true,
    presets: [{ id: "scan", label: "Scan URL params", args: ["--silence", "--no-spinner"] }],
  },
  {
    id: "ffuf",
    label: "ffuf — fast web fuzzer",
    description:
      "Brute-force paths/params with a wordlist. Put FUZZ in the URL where to fuzz, e.g. https://site/FUZZ.",
    active: true,
    presets: [
      {
        id: "dir",
        label: "Directory fuzz (put FUZZ in the URL path)",
        args: ["-w", "/usr/share/wordlists/dirb/common.txt", "-mc", "200,204,301,302,307,401,403", "-s"],
      },
      {
        id: "dirbig",
        label: "Bigger list (dirbuster medium — put FUZZ in the URL)",
        args: ["-w", "/usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt", "-mc", "200,204,301,302,307,401,403", "-s"],
      },
    ],
  },
  {
    id: "gau",
    label: "gau — known URL discovery",
    description:
      "Fetch a domain's historical URLs from Wayback/CommonCrawl/OTX (passive — feeds deeper testing).",
    active: false,
    presets: [{ id: "urls", label: "Fetch known URLs (incl. subdomains)", args: ["--subs"] }],
  },
  {
    id: "searchsploit",
    label: "searchsploit — Exploit-DB search",
    description:
      "Search the local Exploit-DB for known exploits matching a product/version (offline lookup).",
    active: false,
    presets: [{ id: "search", label: "Search term", args: [] }],
  },
  {
    id: "feroxbuster",
    label: "feroxbuster — content discovery",
    description:
      "Fast recursive directory/file brute-forcing over HTTP(S) to find hidden paths.",
    active: true,
    presets: [{ id: "scan", label: "Recursive scan", args: ["--silent", "-d", "2"] }],
  },
  {
    id: "dirsearch",
    label: "dirsearch — web path scanner",
    description: "Brute-force web paths and files with a built-in wordlist.",
    active: true,
    presets: [{ id: "scan", label: "Scan", args: ["-q"] }],
  },
  {
    id: "testssl",
    label: "testssl.sh — TLS/SSL audit",
    description:
      "Check a server's TLS/SSL configuration, protocols, ciphers and known flaws.",
    active: false,
    presets: [{ id: "scan", label: "Full TLS check", args: ["--quiet"] }],
  },
  {
    id: "sslyze",
    label: "sslyze — TLS scanner",
    description: "Fast, deep analysis of a server's TLS configuration and certificate.",
    active: false,
    presets: [{ id: "scan", label: "Scan (host[:port])", args: [] }],
  },
  {
    id: "nbtscan",
    label: "nbtscan — NetBIOS scan",
    description: "Scan a host or network for NetBIOS name info (Windows hosts/shares).",
    active: true,
    presets: [{ id: "scan", label: "Scan host/CIDR", args: [] }],
  },
  {
    id: "smbmap",
    label: "smbmap — SMB share enum",
    description: "Enumerate SMB shares, permissions and contents on a host.",
    active: true,
    presets: [{ id: "scan", label: "List shares", args: [] }],
  },
  {
    id: "fierce",
    label: "fierce — DNS recon",
    description: "Discover IP space and hostnames for a domain via DNS (zone walking).",
    active: false,
    presets: [{ id: "scan", label: "Recon domain", args: [] }],
  },
  {
    id: "sublist3r",
    label: "Sublist3r — subdomain enum",
    description: "Enumerate a domain's subdomains using public search engines (passive).",
    active: false,
    presets: [{ id: "scan", label: "Enumerate", args: [] }],
  },
  {
    id: "commix",
    label: "commix — command injection",
    description:
      "Detect and exploit OS command-injection in a URL parameter (authorized only).",
    active: true,
    presets: [{ id: "detect", label: "Detect (batch)", args: ["--batch"] }],
  },
  {
    id: "gospider",
    label: "gospider — web crawler",
    description: "Fast web spider that collects URLs, JS links and forms from a site.",
    active: true,
    presets: [{ id: "crawl", label: "Crawl (depth 2)", args: ["-q", "-d", "2"] }],
  },
  {
    id: "waybackurls",
    label: "waybackurls — archived URLs",
    description: "Fetch a domain's historical URLs from the Wayback Machine (passive).",
    active: false,
    presets: [{ id: "urls", label: "Fetch URLs", args: [] }],
  },
  {
    id: "onesixtyone",
    label: "onesixtyone — SNMP community scan",
    description: "Fast SNMP scanner: finds devices answering default community strings (public/private).",
    active: true,
    presets: [{ id: "scan", label: "Scan defaults", args: [] }],
  },
  {
    id: "snmpcheck",
    label: "snmp-check — SNMP enumeration",
    description: "Enumerate a host over SNMP (system, network, processes) via the default community.",
    active: true,
    presets: [{ id: "enum", label: "Enumerate (public)", args: [] }],
  },
  {
    id: "crackmapexec",
    label: "crackmapexec — SMB/AD enumeration",
    description: "Enumerate SMB hosts: OS, signing, SMBv1, shares and (with creds) much more.",
    active: true,
    presets: [
      { id: "smb", label: "SMB null-session enum", args: ["smb"] },
      { id: "smb-shares", label: "SMB shares (null session)", args: ["smb", "--shares"] },
    ],
  },
  {
    id: "joomscan",
    label: "joomscan — Joomla scanner",
    description: "Detect Joomla version, vulnerable components and misconfigurations (like wpscan for Joomla).",
    active: true,
    presets: [{ id: "scan", label: "Scan", args: [] }],
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
  subfinder: { bin: "subfinder", flag: "-d" },
  naabu: { bin: "naabu", flag: "-host" },
  katana: { bin: "katana", flag: "-u" },
  // dalfox runs `dalfox url <url>` — the "url" subcommand is the flag token.
  dalfox: { bin: "dalfox", flag: "url" },
  ffuf: { bin: "ffuf", flag: "-u" },
  gau: { bin: "gau", flag: null },
  feroxbuster: { bin: "feroxbuster", flag: "-u" },
  dirsearch: { bin: "dirsearch", flag: "-u" },
  testssl: { bin: "testssl.sh", flag: null },
  sslyze: { bin: "sslyze", flag: null },
  nbtscan: { bin: "nbtscan", flag: null },
  smbmap: { bin: "smbmap", flag: "-H" },
  fierce: { bin: "fierce", flag: "--domain" },
  sublist3r: { bin: "sublist3r", flag: "-d" },
  commix: { bin: "commix", flag: "--url" },
  gospider: { bin: "gospider", flag: "-s" },
  waybackurls: { bin: "waybackurls", flag: null },
  onesixtyone: { bin: "onesixtyone", flag: null },
  snmpcheck: { bin: "snmp-check", flag: null },
  // crackmapexec runs `crackmapexec smb <host>` — the preset supplies "smb".
  crackmapexec: { bin: "crackmapexec", flag: null },
  joomscan: { bin: "joomscan", flag: "-u" },
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
  subfinder: "subfinder",
  naabu: "naabu",
  katana: "katana",
  dalfox: "dalfox",
  ffuf: "ffuf", // fast web fuzzer (Kali apt; go fallback elsewhere)
  metasploit: "metasploit-framework", // for the Exploitation section (no auto-find tool)
  tor: "tor", // for anonymity
  torsocks: "torsocks", // for anonymity
  aircrack: "aircrack-ng", // WiFi suite (airodump-ng, airmon-ng, aireplay-ng)
  hashcat: "hashcat", // GPU/CPU password cracking (WPA mode 22000)
  hcxtools: "hcxtools", // convert captures to hashcat 22000 (hcxpcapngtool)
  hcxdumptool: "hcxdumptool", // clientless PMKID capture
  wifiphisher: "wifiphisher", // evil-twin + captive-portal (authorized testing)
  feroxbuster: "feroxbuster", // recursive content discovery
  dirsearch: "dirsearch", // web path brute-forcer
  testssl: "testssl.sh", // TLS/SSL audit
  sslyze: "sslyze", // TLS scanner
  nbtscan: "nbtscan", // NetBIOS scan
  smbmap: "smbmap", // SMB share enumeration
  fierce: "fierce", // DNS recon
  sublist3r: "sublist3r", // subdomain enumeration
  commix: "commix", // command-injection (authorized)
  onesixtyone: "onesixtyone", // SNMP community scanner
  snmpcheck: "snmp-check", // SNMP enumeration (Kali package provides snmp-check)
  crackmapexec: "crackmapexec", // SMB/AD enumeration & exploitation
  joomscan: "joomscan", // Joomla vulnerability scanner
};

/**
 * `go install` sources for Go-based tools. Used two ways:
 *   - as the PRIMARY method when apt has no package (httpx), and
 *   - as a FALLBACK when apt fails or apt-get is unavailable (the other
 *     ProjectDiscovery tools, which apt ships on Kali but not everywhere).
 * The runner mirrors this map and uses its OWN copy — it never runs a command
 * or source string sent by the portal; the portal only names a tool id.
 */
export const GO_SOURCES: Record<string, string> = {
  httpx: "github.com/projectdiscovery/httpx/cmd/httpx@latest",
  subfinder: "github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest",
  naabu: "github.com/projectdiscovery/naabu/v2/cmd/naabu@latest",
  katana: "github.com/projectdiscovery/katana/cmd/katana@latest",
  dalfox: "github.com/hahwul/dalfox/v2@latest",
  nuclei: "github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest",
  ffuf: "github.com/ffuf/ffuf/v2@latest",
  gau: "github.com/lc/gau/v2/cmd/gau@latest",
  gospider: "github.com/jaeles-project/gospider@latest",
  waybackurls: "github.com/tomnomnom/waybackurls@latest",
};

/** Tools whose PRIMARY install method isn't apt (apt has no package for them). */
export const INSTALL_METHODS: Record<string, { method: "go" | "pipx" }> = {
  httpx: { method: "go" }, // no apt package — Go is the only way
  gau: { method: "go" }, // not packaged for apt — install via Go
  gospider: { method: "go" }, // not packaged for apt — install via Go
  waybackurls: { method: "go" }, // not packaged for apt — install via Go
};

/** Every tool that can be installed from the portal (apt OR an alt method). */
export function installableTools(): string[] {
  return Array.from(
    new Set([
      ...Object.keys(INSTALLABLE_PKGS),
      ...Object.keys(INSTALL_METHODS),
      ...Object.keys(GO_SOURCES),
    ]),
  ).sort();
}

export function isInstallable(tool: string): boolean {
  return tool in INSTALLABLE_PKGS || tool in INSTALL_METHODS || tool in GO_SOURCES;
}

/**
 * The resolved install spec sent to the runner: primary method + apt pkg + a Go
 * source (set whenever one exists, so the runner can fall back to `go install`
 * if apt fails). httpx has method "go" (no apt); the rest are apt-primary.
 */
export function installSpec(tool: string): {
  method: "apt" | "go" | "pipx";
  pkg: string | null;
  source: string | null;
} {
  const go = GO_SOURCES[tool] ?? null;
  const alt = INSTALL_METHODS[tool];
  if (alt?.method === "go") return { method: "go", pkg: null, source: go };
  return { method: "apt", pkg: INSTALLABLE_PKGS[tool] ?? null, source: go };
}

/** Short human label for how a tool installs, shown in the Machines UI. */
export function installLabel(tool: string): string {
  const s = installSpec(tool);
  if (s.method === "go") return "go install";
  if (s.method === "pipx") return "pipx";
  return s.source ? `apt ${s.pkg ?? tool} · go fallback` : `apt ${s.pkg ?? tool}`;
}

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
  "subfinder",
  "naabu",
  "gau",
  "testssl",
  "sslyze",
  "nbtscan",
  "smbmap",
  "fierce",
  "sublist3r",
  "waybackurls",
  "onesixtyone",
  "snmpcheck",
  "crackmapexec",
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

/**
 * Queue priority levels (higher runs first). The runner claims queued jobs by
 * priority desc, then oldest-first. Automation uses these so confirming/
 * exploiting a finding jumps ahead of routine recon/scan; a user clicking
 * "↑ Run next" bumps a job above even these (it sets priority above the queue).
 */
export const JOB_PRIORITY = {
  normal: 0, // routine recon/scan/bug-bounty automation
  exploit: 20, // pipeline exploit-stage validation (ahead of recon/scan)
  manual: 40, // user-triggered "Exploit it" / a technique on a finding
} as const;

// Current runner script version. Bump when rdaisec_runner.py changes in a way
// that benefits from a re-pull; the Runners page flags runners reporting an
// older version. (The tool list itself is now server-driven, so most additions
// no longer need a bump.)
export const RUNNER_VERSION = "43";

// A runner is considered offline if it hasn't polled within this window.
export const RUNNER_ONLINE_WINDOW_MS = 90_000;

// A job stuck in "running" longer than this is treated as dead (runner crashed,
// lost connection, or the tool hung) and auto-failed. Must exceed the runner's
// LONGEST per-tool timeout (nmap = 2400s) with margin, or the portal would fail
// a legitimately long scan while the runner is still working on it.
export const JOB_STALE_MS = 45 * 60_000;

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
