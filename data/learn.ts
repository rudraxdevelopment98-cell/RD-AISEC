// Curated techniques/tactics to learn — a personal skill roadmap. Each topic
// says what it is, how to PRACTICE it inside this portal, and a reference.
// Pure data (no DB); progress is tracked per-user in LearnProgress.

export type LearnTopic = {
  id: string;
  title: string;
  category: string;
  level: "beginner" | "intermediate" | "advanced";
  summary: string;
  practice: string; // how to try it in RD-AISEC
  href?: string; // an in-portal page to start
  resource?: string; // external reference
};

export const LEARN_CATEGORIES = [
  "Recon",
  "Web exploitation",
  "Network & infra",
  "WiFi",
  "Exploitation & post-ex",
  "Methodology & reporting",
] as const;

export const LEARN_TOPICS: LearnTopic[] = [
  // ── Recon ──
  {
    id: "subdomain-enum",
    title: "Subdomain enumeration",
    category: "Recon",
    level: "beginner",
    summary: "Find a target's subdomains to expand the attack surface (the #1 source of bug-bounty wins).",
    practice: "Run a program's pipeline — subfinder/amass enumerate wildcards, then httpx probes which are live.",
    href: "/dashboard/bugbounty",
    resource: "https://github.com/projectdiscovery/subfinder",
  },
  {
    id: "js-recon",
    title: "JavaScript & endpoint mining",
    category: "Recon",
    level: "intermediate",
    summary: "Crawl JS to discover hidden API endpoints, parameters, and leaked secrets.",
    practice: "The bug pipeline runs katana (-jc). Watch for 'Crawled endpoints' and 'Exposed … key' findings.",
    href: "/dashboard/findings",
    resource: "https://github.com/projectdiscovery/katana",
  },
  {
    id: "content-discovery",
    title: "Content & directory discovery",
    category: "Recon",
    level: "beginner",
    summary: "Brute-force hidden paths (admin panels, backups, .git, configs).",
    practice: "gobuster runs in the scan stage; review 'Discovered paths' findings for sensitive routes.",
    href: "/dashboard/jobs",
    resource: "https://github.com/OJ/gobuster",
  },
  {
    id: "google-dorking",
    title: "Google dorking / OSINT",
    category: "Recon",
    level: "beginner",
    summary: "Use search operators + public sources to find exposed data without touching the target.",
    practice: "Try theHarvester from Jobs; combine with manual dorks (site:, inurl:, filetype:).",
    resource: "https://www.exploit-db.com/google-hacking-database",
  },

  // ── Web exploitation ──
  {
    id: "idor",
    title: "IDOR / broken access control",
    category: "Web exploitation",
    level: "intermediate",
    summary: "Change an id/reference to access another user's data — scanners rarely catch this; it's manual.",
    practice: "After recon, manually tamper object ids in requests; log confirmed cases as findings.",
    resource: "https://owasp.org/Top10/A01_2021-Broken_Access_Control/",
  },
  {
    id: "sqli",
    title: "SQL injection",
    category: "Web exploitation",
    level: "intermediate",
    summary: "Inject SQL to read/modify the database; can lead to full DB or host compromise.",
    practice: "On a finding with a parameterized URL, use ⚔ Exploit it → it runs sqlmap detection.",
    href: "/dashboard/findings",
    resource: "https://portswigger.net/web-security/sql-injection",
  },
  {
    id: "xss",
    title: "Cross-site scripting (XSS)",
    category: "Web exploitation",
    level: "beginner",
    summary: "Inject script that runs in victims' browsers — session theft, account takeover.",
    practice: "Exploit flow runs dalfox on reflected/param URLs; confirm and log it.",
    resource: "https://portswigger.net/web-security/cross-site-scripting",
  },
  {
    id: "ssrf",
    title: "Server-side request forgery (SSRF)",
    category: "Web exploitation",
    level: "advanced",
    summary: "Make the server fetch attacker-chosen URLs — reach internal services & cloud metadata.",
    practice: "Hunt URL/host parameters manually; test internal/metadata endpoints; log confirmed SSRF.",
    resource: "https://portswigger.net/web-security/ssrf",
  },
  {
    id: "auth-flaws",
    title: "Authentication & session flaws",
    category: "Web exploitation",
    level: "intermediate",
    summary: "Weak resets, JWT issues, missing MFA, session fixation, default creds.",
    practice: "Review nuclei exposures + manually test the auth flow; log weaknesses.",
    resource: "https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/",
  },
  {
    id: "secrets-leak",
    title: "Leaked secrets / API keys",
    category: "Web exploitation",
    level: "beginner",
    summary: "Exposed keys in JS/responses/repos = direct, reliably-paid bounties.",
    practice: "The engine auto-flags 'Exposed … key' findings from httpx/katana output — verify & report.",
    href: "/dashboard/findings",
    resource: "https://owasp.org/www-community/vulnerabilities/Information_exposure",
  },

  // ── Network & infra ──
  {
    id: "port-scanning",
    title: "Port & service scanning",
    category: "Network & infra",
    level: "beginner",
    summary: "Map open ports/services and their versions — the basis for service exploitation.",
    practice: "Run nmap (Service+version) from Jobs or the engagement Command center; view the Network map.",
    href: "/dashboard/network",
    resource: "https://nmap.org/book/",
  },
  {
    id: "service-exploitation",
    title: "Service version → known CVEs",
    category: "Network & infra",
    level: "intermediate",
    summary: "Match a service version to public exploits (searchsploit) and validate safely.",
    practice: "On a service finding, ⚔ Exploit it runs searchsploit + nmap --script vuln.",
    href: "/dashboard/exploit",
    resource: "https://www.exploit-db.com/searchsploit",
  },
  {
    id: "smb-enum",
    title: "SMB / Windows enumeration",
    category: "Network & infra",
    level: "intermediate",
    summary: "Enumerate shares/users; spot null sessions and MS17-010 (EternalBlue).",
    practice: "Run enum4linux from Jobs; the exploit flow adds an MS17-010 scanner check.",
    resource: "https://www.hackingarticles.in/a-detailed-guide-on-enum4linux/",
  },
  {
    id: "tls-issues",
    title: "TLS/SSL weaknesses",
    category: "Network & infra",
    level: "beginner",
    summary: "Deprecated protocols/ciphers, expired/self-signed certs, Heartbleed.",
    practice: "sslscan runs in the scan stage; review the TLS findings + their fixes.",
    resource: "https://www.ssllabs.com/projects/best-practices/",
  },

  // ── WiFi ──
  {
    id: "wifi-recon",
    title: "WiFi recon & client mapping",
    category: "WiFi",
    level: "beginner",
    summary: "Scan APs, see connected devices, signal/distance, and what they're probing for.",
    practice: "WiFi page → Scan, then 🔍 Inspect a network you own.",
    href: "/dashboard/wifi",
    resource: "https://www.aircrack-ng.org/doku.php?id=airodump-ng",
  },
  {
    id: "wpa-handshake",
    title: "WPA handshake capture & cracking",
    category: "WiFi",
    level: "intermediate",
    summary: "Capture a 4-way handshake (or PMKID) and dictionary-crack a weak passphrase.",
    practice: "On YOUR network: Auto handshake → Crack (hashcat/CPU). A crack proves a weak key.",
    href: "/dashboard/wifi",
    resource: "https://hashcat.net/wiki/doku.php?id=cracking_wpawpa2",
  },
  {
    id: "evil-twin",
    title: "Evil twin / captive portal",
    category: "WiFi",
    level: "advanced",
    summary: "Rogue AP + fake portal that harvests the WiFi password (social-engineering).",
    practice: "WiFi Inspect → Evil Twin section gives the wifiphisher command (own network only).",
    href: "/dashboard/wifi",
    resource: "https://github.com/wifiphisher/wifiphisher",
  },

  // ── Exploitation & post-ex ──
  {
    id: "metasploit",
    title: "Metasploit basics",
    category: "Exploitation & post-ex",
    level: "intermediate",
    summary: "Use scanner/check modules to validate, and exploit modules to weaponize (authorized).",
    practice: "Install metasploit on a runner; the exploit flow queues msf scanner checks for SMB/RDP.",
    href: "/dashboard/exploit",
    resource: "https://docs.metasploit.com/",
  },
  {
    id: "write-poc",
    title: "Writing a PoC / exploit",
    category: "Exploitation & post-ex",
    level: "advanced",
    summary: "Turn a finding into a minimal proof-of-concept that demonstrates impact.",
    practice: "From a finding, ⚒ Build → the Exploit Lab pre-fills a template; edit, save to Kali, run.",
    href: "/dashboard/lab",
    resource: "https://www.exploit-db.com/",
  },

  // ── Methodology & reporting ──
  {
    id: "scope-rules",
    title: "Scope & program rules",
    category: "Methodology & reporting",
    level: "beginner",
    summary: "Stay in scope, respect rate limits, identify your traffic — or get banned.",
    practice: "Only test engaged programs; the engine sends an X-Bug-Hunter header and rate-limits scans.",
    href: "/dashboard/guide",
    resource: "https://docs.hackerone.com/hackers/hacker-guidelines.html",
  },
  {
    id: "report-writing",
    title: "Writing a great report",
    category: "Methodology & reporting",
    level: "intermediate",
    summary: "Clear title, impact, reproduction steps, and a fix — what gets bugs accepted & paid.",
    practice: "Generate the engagement Report and use the submission draft on confirmed findings.",
    href: "/dashboard/engagements",
    resource: "https://docs.hackerone.com/hackers/quality-reports.html",
  },
  {
    id: "opsec",
    title: "Operational security (authorized)",
    category: "Methodology & reporting",
    level: "intermediate",
    summary: "Route via Tor when allowed, don't store target creds, keep evidence safe.",
    practice: "Toggle Tor on a runner (Machines); secrets are stored encrypted; scope-gate everything.",
    href: "/dashboard/runners",
    resource: "https://owasp.org/www-project-web-security-testing-guide/",
  },
];
