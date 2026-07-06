// Feature progress catalog — what's built vs. what's still to do, per area.
// Curated (not auto-derived), so keep it honest and up to date as work lands.
// Rendered on /dashboard/progress.

export type ProgressArea = {
  area: string;
  icon: string;
  summary: string;
  done: string[];
  todo: string[];
};

export const PROGRESS: ProgressArea[] = [
  {
    area: "Bug Bounty",
    icon: "target",
    summary: "Track programs, pull scope, engage and automate.",
    done: [
      "Program tracking across platforms (HackerOne, Bugcrowd, Intigriti, YesWeHack)",
      "HackerOne API sync (exact structured scope)",
      "Bugcrowd scope import from the public changelog (unauthenticated)",
      "One-click scope auto-fill from a program link",
      "Resync scope — per program and all-at-once (union merge, never loses targets)",
      "Engaged sub-tab so active hunts don't get lost",
      "Opportunity scoring + run-pipeline-now + daily automation",
    ],
    todo: [
      "Native scope import for Intigriti & YesWeHack (like Bugcrowd)",
      "Submission drafting + export to the platform's format",
      "Cross-program duplicate detection",
      "Reward / earnings tracking",
    ],
  },
  {
    area: "Scanning & Recon",
    icon: "radar",
    summary: "Find surface and probe it, on your own machines.",
    done: [
      "Subdomains (subfinder/amass), live hosts (httpx), tech detect",
      "Vuln scan (nuclei, CVSS-escalated), ports/services (nmap)",
      "Content discovery (gobuster/katana), nikto, sslscan",
      "XSS (dalfox), SQLi (sqlmap), WordPress (wpscan)",
      "Exploit lookup (searchsploit) + deep pipeline",
      "Authenticated scanning (inject a stored session header)",
    ],
    todo: [
      "Smarter rate-limit / WAF-aware pacing",
      "Broader DAST coverage + API (OpenAPI) scanning",
      "Per-target schedules and drift detection",
    ],
  },
  {
    area: "Accuracy (finding quality)",
    icon: "shield",
    summary: "Fewer false positives; real bugs, not noise.",
    done: [
      "Import gate: freshness (patched → drop, banner-only → soften) + proof",
      "Suppression (allow beats suppress) with signatures",
      "Exploit confidence: reported → validated → proven",
      "De-dup + cross-tool corroboration (🔗 N tools)",
      "Parser negation guards; searchsploit product-keyword gate",
      "Triage signal score — ranks real bugs over noise (severity × proof × agreement)",
    ],
    todo: [
      "Cross-tool severity reconciliation",
      "AI-assisted triage / summarization (owner key)",
      "Auto-reproduction to confirm before reporting",
      "False-positive learning loop expansion",
    ],
  },
  {
    area: "Exploitation",
    icon: "skull",
    summary: "Validate a finding for real, then secure it.",
    done: [
      "Per-finding exploitability check (live)",
      "Technique playbooks + detailed browser repro steps",
      "Exploit Lab PoC builder → save to Kali",
      "searchsploit / Metasploit run + confirm-yourself flow",
    ],
    todo: [
      "Guided exploit chaining",
      "More playbooks (SSRF, deserialization, auth bypass depth)",
      "Optional safe auto-exploit on authorized targets",
    ],
  },
  {
    area: "Machines / Runner",
    icon: "server",
    summary: "Your Kali machines, controlled from the portal.",
    done: [
      "Remote runner, tool install, live allowlist",
      "Parallelism control + ⚡ Turbo (drain backlog)",
      "Live stats: CPU · RAM · Disk · GPU · temp · battery/power · load · uptime",
      "Self-update (jumps straight to latest, idle-gated)",
      "Remote restart from the engine",
    ],
    todo: [
      "Multi-machine load balancing across a fleet",
      "GPU cracking queue + status",
      "Update available at-a-glance across all machines (done: dots)",
    ],
  },
  {
    area: "WiFi & Sensing",
    icon: "globe",
    summary: "Wireless recon, cracking, and WiFi sensing.",
    done: [
      "Scan / capture / crack, Auto-pwn, Auto Evil-Twin",
      "3D sensing observatory (Three.js): room, figure, propagation",
      "Real presence + motion from the connected AP's RSSI variance",
      "Motion algorithm: baseline detrending + presence hysteresis (ignores slow drift)",
    ],
    todo: [
      "CSI hardware path for true pose / breathing / heart-rate",
      "Continuous (auto-repeating) live sensing",
      "Monitor-mode multi-AP sensing for position",
    ],
  },
  {
    area: "Forensics & Consulting",
    icon: "fingerprint",
    summary: "Evidence handling and posture assessments.",
    done: [
      "Evidence + chain of custody (hashes, custody events)",
      "Assessments + control results (NIST CSF, CIS 8, OWASP ASVS)",
      "Posture scoring + maturity by domain",
    ],
    todo: [
      "Timeline / artifact parsers (disk, memory)",
      "Per-framework report templates + gap remediation tracking",
    ],
  },
  {
    area: "Reporting & Engagement Map",
    icon: "book",
    summary: "Client-ready output and the whole-engagement picture.",
    done: [
      "Client-ready report (findings + posture + evidence + KEV)",
      "Engagement Map: layered topology, filters, minimap, export, saved layout",
    ],
    todo: [
      "PDF export + branding + AI exec summary",
      "Live collaboration on the map",
    ],
  },
  {
    area: "Voice & Assistant",
    icon: "bot",
    summary: "Hands-free control and AI help.",
    done: [
      "Voice commands + spoken replies + wake word (Shiva)",
      "Conversational follow-ups (it asks, you answer) + friendly persona",
    ],
    todo: [
      "Multi-turn memory across a session",
      "More voice intents (queue scans by voice with confirm)",
      "Custom wake word",
    ],
  },
  {
    area: "Platform & UX",
    icon: "grid",
    summary: "Access, monitoring, and the interface itself.",
    done: [
      "Auth, members + access control, SIEM audit trail, monitoring",
      "Sticky headers, floating controls, compact density, smooth scrolling",
      "Footer activity monitor (jobs, ETA, machine stats)",
      "UI audit — contrast/overlap/alignment pass across main + secondary pages",
    ],
    todo: [
      "Accessibility pass (focus, contrast, labels)",
      "Remaining mobile polish on data-dense tables",
      "Alerts / notifications channel + webhooks + API tokens",
    ],
  },
];
