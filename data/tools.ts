export type SecurityTool = {
  name: string;
  category: string;
  license: "Open Source" | "Freemium" | "Paid";
  description: string;
  /** What you'd typically use it for, in one line. */
  useCase: string;
  url: string;
};

/**
 * A starter catalog of widely used modern security tools. Extend freely — the
 * catalog UI is data-driven, so adding entries here is all that's needed.
 */
export const TOOLS: SecurityTool[] = [
  {
    name: "Nmap",
    category: "Reconnaissance",
    license: "Open Source",
    description: "Network scanner for host discovery, port scanning, and service/version detection.",
    useCase: "Map what's exposed on a network before deeper testing.",
    url: "https://nmap.org",
  },
  {
    name: "Wireshark",
    category: "Network Analysis",
    license: "Open Source",
    description: "Deep packet inspection and protocol analysis for live and captured traffic.",
    useCase: "Inspect exactly what's on the wire to debug or detect anomalies.",
    url: "https://www.wireshark.org",
  },
  {
    name: "Burp Suite",
    category: "Web App Testing",
    license: "Freemium",
    description: "Intercepting proxy and web vulnerability scanner for HTTP(S) testing.",
    useCase: "Intercept, modify, and fuzz web requests during app assessments.",
    url: "https://portswigger.net/burp",
  },
  {
    name: "OWASP ZAP",
    category: "Web App Testing",
    license: "Open Source",
    description: "Full-featured web app scanner and intercepting proxy from OWASP.",
    useCase: "Free alternative to Burp for automated and manual web testing.",
    url: "https://www.zaproxy.org",
  },
  {
    name: "Metasploit",
    category: "Exploitation",
    license: "Freemium",
    description: "Exploitation framework with a large library of modules and payloads.",
    useCase: "Validate vulnerabilities with proven exploits in authorized tests.",
    url: "https://www.metasploit.com",
  },
  {
    name: "sqlmap",
    category: "Exploitation",
    license: "Open Source",
    description: "Automated SQL injection detection and exploitation tool.",
    useCase: "Find and demonstrate SQL injection impact safely.",
    url: "https://sqlmap.org",
  },
  {
    name: "Nuclei",
    category: "Vulnerability Scanning",
    license: "Open Source",
    description: "Fast, template-based vulnerability scanner for known issues.",
    useCase: "Scan at scale using community-maintained detection templates.",
    url: "https://github.com/projectdiscovery/nuclei",
  },
  {
    name: "Nikto",
    category: "Vulnerability Scanning",
    license: "Open Source",
    description: "Web server scanner that checks for dangerous files and misconfigurations.",
    useCase: "Quick first-pass scan of a web server's hygiene.",
    url: "https://github.com/sullo/nikto",
  },
  {
    name: "Semgrep",
    category: "Static Analysis (SAST)",
    license: "Freemium",
    description: "Fast, rule-based static analysis for finding bugs and security issues in code.",
    useCase: "Catch vulnerable code patterns in CI before they ship.",
    url: "https://semgrep.dev",
  },
  {
    name: "Trivy",
    category: "Supply Chain / Containers",
    license: "Open Source",
    description: "Scanner for container images, filesystems, and dependencies.",
    useCase: "Find known CVEs and misconfigs in images and IaC.",
    url: "https://github.com/aquasecurity/trivy",
  },
  {
    name: "Gitleaks",
    category: "Secrets Detection",
    license: "Open Source",
    description: "Detect hardcoded secrets and credentials in git repos.",
    useCase: "Stop API keys and passwords from leaking into source control.",
    url: "https://github.com/gitleaks/gitleaks",
  },
  {
    name: "John the Ripper",
    category: "Password Auditing",
    license: "Open Source",
    description: "Password cracker for auditing the strength of stored hashes.",
    useCase: "Test whether your password policy resists offline cracking.",
    url: "https://www.openwall.com/john",
  },
  {
    name: "Hashcat",
    category: "Password Auditing",
    license: "Open Source",
    description: "GPU-accelerated password recovery supporting many hash types.",
    useCase: "Audit hash strength at high speed in authorized assessments.",
    url: "https://hashcat.net/hashcat",
  },
  {
    name: "Wazuh",
    category: "Defense / SIEM",
    license: "Open Source",
    description: "Security monitoring platform: log analysis, intrusion detection, and alerting.",
    useCase: "Detect and respond to threats across your fleet.",
    url: "https://wazuh.com",
  },
  {
    name: "Suricata",
    category: "Defense / IDS",
    license: "Open Source",
    description: "High-performance network IDS/IPS and network security monitoring engine.",
    useCase: "Detect malicious network traffic in real time.",
    url: "https://suricata.io",
  },
  {
    name: "CrowdStrike Falcon",
    category: "Defense / EDR",
    license: "Paid",
    description: "Cloud-delivered endpoint detection and response platform.",
    useCase: "Enterprise-grade endpoint protection and threat hunting.",
    url: "https://www.crowdstrike.com",
  },
  {
    name: "Tenable Nessus",
    category: "Vulnerability Scanning",
    license: "Paid",
    description: "Industry-standard vulnerability scanner for networks and hosts.",
    useCase: "Comprehensive, compliance-ready vulnerability assessments.",
    url: "https://www.tenable.com/products/nessus",
  },
];

export const CATEGORIES = Array.from(new Set(TOOLS.map((t) => t.category))).sort();
