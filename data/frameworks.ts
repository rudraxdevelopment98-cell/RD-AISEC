// Security frameworks & standards the portal references — surfaced in the
// Frameworks page and used as grounding for the knowledge base / future
// auto-mapping of findings (e.g. tag a finding with its OWASP / ATT&CK ref).

export type Ref = { id: string; name: string; desc: string };

// MITRE ATT&CK — Enterprise tactics (the "why" columns of the matrix).
export const MITRE_TACTICS: Ref[] = [
  { id: "TA0043", name: "Reconnaissance", desc: "Gathering info to plan future operations." },
  { id: "TA0042", name: "Resource Development", desc: "Establishing resources to support operations." },
  { id: "TA0001", name: "Initial Access", desc: "Getting into the network." },
  { id: "TA0002", name: "Execution", desc: "Running malicious code." },
  { id: "TA0003", name: "Persistence", desc: "Maintaining a foothold." },
  { id: "TA0004", name: "Privilege Escalation", desc: "Gaining higher-level permissions." },
  { id: "TA0005", name: "Defense Evasion", desc: "Avoiding detection." },
  { id: "TA0006", name: "Credential Access", desc: "Stealing accounts and secrets." },
  { id: "TA0007", name: "Discovery", desc: "Figuring out the environment." },
  { id: "TA0008", name: "Lateral Movement", desc: "Moving through the environment." },
  { id: "TA0009", name: "Collection", desc: "Gathering data of interest." },
  { id: "TA0011", name: "Command and Control", desc: "Communicating with compromised systems." },
  { id: "TA0010", name: "Exfiltration", desc: "Stealing data." },
  { id: "TA0040", name: "Impact", desc: "Manipulate, interrupt, or destroy systems/data." },
];

// OWASP Top 10 — 2021.
export const OWASP_TOP10: Ref[] = [
  { id: "A01", name: "Broken Access Control", desc: "Users acting outside intended permissions." },
  { id: "A02", name: "Cryptographic Failures", desc: "Weak/missing protection of data in transit & at rest." },
  { id: "A03", name: "Injection", desc: "SQL/NoSQL/OS/LDAP injection from untrusted input." },
  { id: "A04", name: "Insecure Design", desc: "Missing or ineffective security controls by design." },
  { id: "A05", name: "Security Misconfiguration", desc: "Insecure defaults, verbose errors, open config." },
  { id: "A06", name: "Vulnerable & Outdated Components", desc: "Known-vulnerable libraries/services." },
  { id: "A07", name: "Identification & Auth Failures", desc: "Weak auth, session, or credential handling." },
  { id: "A08", name: "Software & Data Integrity Failures", desc: "Unverified updates, insecure CI/CD, deserialization." },
  { id: "A09", name: "Logging & Monitoring Failures", desc: "Insufficient detection and response visibility." },
  { id: "A10", name: "Server-Side Request Forgery", desc: "Server coerced into making attacker-chosen requests." },
];

// NIST Cybersecurity Framework 2.0 — core functions.
export const NIST_CSF: Ref[] = [
  { id: "GV", name: "Govern", desc: "Risk strategy, roles, policy, and oversight." },
  { id: "ID", name: "Identify", desc: "Understand assets, risks, and the environment." },
  { id: "PR", name: "Protect", desc: "Safeguards to limit or contain impact." },
  { id: "DE", name: "Detect", desc: "Find and analyze attacks and anomalies." },
  { id: "RS", name: "Respond", desc: "Act on detected incidents." },
  { id: "RC", name: "Recover", desc: "Restore capabilities after an incident." },
];

// Tools & detection frameworks the runner / knowledge base draw on.
export type ToolRef = { name: string; kind: string; desc: string; url: string };
export const TOOL_FRAMEWORKS: ToolRef[] = [
  { name: "Metasploit", kind: "Exploitation", desc: "Exploit dev & validation framework (modules, payloads, post-exploitation).", url: "https://docs.metasploit.com/" },
  { name: "Nuclei", kind: "Scanning", desc: "Template-based vulnerability & exposure scanner (community templates).", url: "https://docs.projectdiscovery.io/tools/nuclei" },
  { name: "Zeek", kind: "Network monitoring", desc: "Network security monitor producing rich connection & protocol logs.", url: "https://docs.zeek.org/" },
  { name: "Suricata", kind: "IDS/IPS", desc: "Signature & protocol network intrusion detection/prevention.", url: "https://suricata.io/" },
  { name: "Sigma", kind: "Detection rules", desc: "Generic signature format for SIEM log detections.", url: "https://sigmahq.io/" },
  { name: "CVE / NVD", kind: "Vuln data", desc: "Public catalog of known vulnerabilities and their scores.", url: "https://nvd.nist.gov/" },
];
