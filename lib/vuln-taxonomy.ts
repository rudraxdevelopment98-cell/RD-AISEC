// Vulnerability taxonomy — the shared, detailed classification source of truth.
//
// Deepens FINDING detection: maps a finding's text to a vulnerability class with
// its OWASP + CWE + MITRE ATT&CK references, an approximate CVSS band, an
// exploitability tier, the attack surface it lives on, and the concrete
// indicators to look for. Pure (no DB/IO), so it is client-safe AND unit
// testable. The exploitation-strategy engine (lib/exploit-strategy) builds on
// this. For authorized security testing and education only.

export type Surface = "web" | "api" | "network" | "host" | "cloud" | "auth" | "crypto" | "info";
export type Tier = "critical" | "high" | "medium" | "low";

export type VulnClass = {
  id: string;
  label: string;
  /** Detection regex — ordered most-specific-first in CLASSES. */
  re: RegExp;
  owasp: string; // OWASP Top 10 (2021) category
  cwe: string; // primary CWE
  attack: string; // MITRE ATT&CK technique (best-effort)
  cvss: string; // representative CVSS v3.1 band
  tier: Tier;
  surface: Surface;
  /** Signals an operator/tool should look for to confirm the class. */
  indicators: string[];
  /** One-line description of the weakness. */
  summary: string;
};

// Ordered most-specific → most-general. classifyVuln returns the first match.
export const VULN_CLASSES: VulnClass[] = [
  {
    id: "rce",
    label: "Remote Code Execution",
    re: /remote code execution|\brce\b|command injection|os command|arbitrary code|code execution/i,
    owasp: "A03:2021 Injection",
    cwe: "CWE-94",
    attack: "T1190",
    cvss: "9.0–10.0",
    tier: "critical",
    surface: "web",
    indicators: ["command output reflected", "out-of-band DNS/HTTP callback", "sleep/delay works"],
    summary: "Attacker-controlled input is executed as code or an OS command on the server.",
  },
  {
    id: "deserialization",
    label: "Insecure Deserialization",
    re: /deserial|insecure deserialization|pickle|ObjectInputStream|marshal|__reduce__/i,
    owasp: "A08:2021 Software & Data Integrity",
    cwe: "CWE-502",
    attack: "T1190",
    cvss: "9.0–9.8",
    tier: "critical",
    surface: "web",
    indicators: ["serialized blob in a parameter/cookie", "gadget-chain callback", "type confusion errors"],
    summary: "Untrusted serialized data is deserialized, enabling code execution or object injection.",
  },
  {
    id: "sqli",
    label: "SQL Injection",
    re: /sql ?injection|\bsqli\b|union select|error-based sql|boolean-based blind/i,
    owasp: "A03:2021 Injection",
    cwe: "CWE-89",
    attack: "T1190",
    cvss: "8.0–9.8",
    tier: "critical",
    surface: "web",
    indicators: ["DB error on quote", "true/false payload differential", "time-based delay", "named DBMS"],
    summary: "User input is concatenated into a SQL query, exposing the database.",
  },
  {
    id: "nosqli",
    label: "NoSQL Injection",
    re: /nosql ?injection|\bnosqli\b|\$where|\$ne\b|mongodb injection/i,
    owasp: "A03:2021 Injection",
    cwe: "CWE-943",
    attack: "T1190",
    cvss: "7.5–9.1",
    tier: "high",
    surface: "web",
    indicators: ["operator injection ($ne/$gt)", "auth bypass with {\"$ne\":null}", "JSON body reflection"],
    summary: "Query operators are injected into a NoSQL query (e.g. MongoDB) to bypass logic.",
  },
  {
    id: "ssti",
    label: "Server-Side Template Injection",
    re: /template injection|\bssti\b|\{\{.*\}\}|jinja2|freemarker|velocity|twig/i,
    owasp: "A03:2021 Injection",
    cwe: "CWE-1336",
    attack: "T1190",
    cvss: "8.6–9.8",
    tier: "critical",
    surface: "web",
    indicators: ["{{7*7}} → 49", "template engine error", "object introspection reachable"],
    summary: "Input is evaluated by a server-side template engine, often leading to RCE.",
  },
  {
    id: "xxe",
    label: "XML External Entity (XXE)",
    re: /\bxxe\b|xml external entit|<!ENTITY|SYSTEM \"file:|billion laughs/i,
    owasp: "A05:2021 Security Misconfiguration",
    cwe: "CWE-611",
    attack: "T1190",
    cvss: "7.1–9.1",
    tier: "high",
    surface: "web",
    indicators: ["file:// entity reflected", "OOB entity callback", "SSRF via entity"],
    summary: "An XML parser resolves external entities, enabling file read or SSRF.",
  },
  {
    id: "auth_bypass",
    label: "Authentication Bypass",
    re: /authentication bypass|auth bypass|login bypass|broken authentication|jwt (none|alg|forge)|session fixation/i,
    owasp: "A07:2021 Identification & Authentication",
    cwe: "CWE-287",
    attack: "T1078",
    cvss: "8.1–9.8",
    tier: "critical",
    surface: "auth",
    indicators: ["access without valid creds", "JWT alg=none accepted", "predictable session token"],
    summary: "The authentication mechanism can be bypassed to gain access as a user.",
  },
  {
    id: "ato",
    label: "Account Takeover",
    re: /account takeover|\bato\b|password reset (poisoning|takeover)|otp bypass/i,
    owasp: "A07:2021 Identification & Authentication",
    cwe: "CWE-640",
    attack: "T1078",
    cvss: "8.1–9.8",
    tier: "critical",
    surface: "auth",
    indicators: ["reset token leak/reuse", "host-header reset poisoning", "OTP brute/bypass"],
    summary: "An attacker can seize another user's account (reset flow, OTP, or token flaw).",
  },
  {
    id: "idor",
    label: "IDOR / Broken Access Control",
    re: /\bidor\b|insecure direct object|broken (access control|authorization)|mass assignment|forced browsing|privilege escalation|priv ?esc/i,
    owasp: "A01:2021 Broken Access Control",
    cwe: "CWE-639",
    attack: "T1068",
    cvss: "6.5–8.1",
    tier: "high",
    surface: "api",
    indicators: ["object id swap returns another user's data", "role field editable", "hidden endpoint reachable"],
    summary: "Missing per-object authorization lets a user access others' data or actions.",
  },
  {
    id: "ssrf",
    label: "Server-Side Request Forgery",
    re: /\bssrf\b|server-side request forgery|metadata (endpoint|service)|169\.254\.169\.254/i,
    owasp: "A10:2021 SSRF",
    cwe: "CWE-918",
    attack: "T1190",
    cvss: "7.5–9.1",
    tier: "high",
    surface: "web",
    indicators: ["server fetches attacker URL", "cloud metadata reachable", "internal port scan via app"],
    summary: "The server can be coerced into making requests to internal/attacker targets.",
  },
  {
    id: "lfi",
    label: "Path Traversal / File Read",
    re: /arbitrary file (read|access|download)|path traversal|\blfi\b|local file inclusion|directory traversal|\.\.\/|%2e%2e/i,
    owasp: "A01:2021 Broken Access Control",
    cwe: "CWE-22",
    attack: "T1083",
    cvss: "7.5–9.1",
    tier: "high",
    surface: "web",
    indicators: ["/etc/passwd contents", "traversal sequence honored", "source disclosed"],
    summary: "Input reaches a file path, allowing reading files outside the intended directory.",
  },
  {
    id: "file_upload",
    label: "Unrestricted File Upload",
    re: /file upload|unrestricted upload|arbitrary file upload|webshell|\.php upload|content-type bypass/i,
    owasp: "A04:2021 Insecure Design",
    cwe: "CWE-434",
    attack: "T1505.003",
    cvss: "8.1–9.8",
    tier: "critical",
    surface: "web",
    indicators: ["executable served back", "extension/content-type check bypassed", "path predictable"],
    summary: "Uploaded files aren't validated, allowing a webshell or malicious content.",
  },
  {
    id: "stored_xss",
    label: "Stored XSS",
    re: /stored (xss|cross-site)|persistent xss|second-order xss/i,
    owasp: "A03:2021 Injection",
    cwe: "CWE-79",
    attack: "T1059.007",
    cvss: "6.1–8.7",
    tier: "high",
    surface: "web",
    indicators: ["payload persists and executes for other users", "renders unencoded"],
    summary: "Persisted user input executes as script in other users' browsers.",
  },
  {
    id: "reflected_xss",
    label: "Reflected XSS",
    re: /reflected (xss|cross-site)|\bxss\b|cross[- ]site scripting|dom xss/i,
    owasp: "A03:2021 Injection",
    cwe: "CWE-79",
    attack: "T1059.007",
    cvss: "4.3–6.1",
    tier: "medium",
    surface: "web",
    indicators: ["payload reflected unencoded", "alert()/DOM sink fires"],
    summary: "User input is reflected into a response and executes in the victim's browser.",
  },
  {
    id: "secrets",
    label: "Secret / Credential Exposure",
    re: /secret(s)? (disclosure|exposure|leak)|hard-?coded (secret|credential|key)|(api|access|secret)[_ ]?key.{0,20}(leak|expos|disclos)|aws[_ ]?(access|secret)[_ ]?key|private key|credential(s)? (expos|leak|disclos)|token (leak|expos)|\.env\b|\.git\b/i,
    owasp: "A05:2021 Security Misconfiguration",
    cwe: "CWE-798",
    attack: "T1552",
    cvss: "7.5–9.8",
    tier: "high",
    surface: "info",
    indicators: ["live API key/token", "private key material", ".env / .git exposed"],
    summary: "Secrets are exposed in code, config, or responses and may still be valid.",
  },
  {
    id: "cors",
    label: "CORS Misconfiguration",
    re: /\bcors\b|access-control-allow-origin|cross-origin (misconfig|resource)/i,
    owasp: "A05:2021 Security Misconfiguration",
    cwe: "CWE-942",
    attack: "T1190",
    cvss: "5.3–7.5",
    tier: "medium",
    surface: "web",
    indicators: ["ACAO reflects arbitrary Origin", "ACAC:true with wildcard origin"],
    summary: "A permissive CORS policy lets malicious origins read authenticated responses.",
  },
  {
    id: "subdomain_takeover",
    label: "Subdomain Takeover",
    re: /subdomain takeover|dangling (dns|cname)|nxdomain.*cname|unclaimed (bucket|resource)/i,
    owasp: "A05:2021 Security Misconfiguration",
    cwe: "CWE-350",
    attack: "T1584.001",
    cvss: "6.5–8.2",
    tier: "high",
    surface: "cloud",
    indicators: ["CNAME points to unclaimed service", "fingerprint page (NoSuchBucket etc.)"],
    summary: "A dangling DNS record points to a de-provisioned service an attacker can claim.",
  },
  {
    id: "open_redirect",
    label: "Open Redirect",
    re: /open redirect|unvalidated redirect|url redirection/i,
    owasp: "A01:2021 Broken Access Control",
    cwe: "CWE-601",
    attack: "T1204",
    cvss: "4.3–6.1",
    tier: "low",
    surface: "web",
    indicators: ["redirect param honors external host", "//evil.com accepted"],
    summary: "A redirect parameter isn't validated, aiding phishing and token theft.",
  },
  {
    id: "csrf",
    label: "Cross-Site Request Forgery",
    re: /\bcsrf\b|cross-site request forgery|missing (csrf|anti-forgery) token/i,
    owasp: "A01:2021 Broken Access Control",
    cwe: "CWE-352",
    attack: "T1204",
    cvss: "4.3–6.5",
    tier: "medium",
    surface: "web",
    indicators: ["state-changing request lacks token", "SameSite not set"],
    summary: "State-changing requests lack anti-forgery protection, allowing forced actions.",
  },
  {
    id: "legacy_smb",
    label: "Legacy SMB (EternalBlue class)",
    re: /\bsmbv1\b|eternalblue|ms17-010|smb signing (disabled|not required)/i,
    owasp: "A06:2021 Vulnerable Components",
    cwe: "CWE-1188",
    attack: "T1210",
    cvss: "8.1–9.8",
    tier: "critical",
    surface: "network",
    indicators: ["SMBv1 enabled", "MS17-010 check VULNERABLE", "signing:False"],
    summary: "Legacy/unpatched SMB exposes remote code execution or relay attacks.",
  },
  {
    id: "default_creds",
    label: "Default / Weak Credentials",
    re: /default (credential|password|login)|weak password|admin:admin|blank password|guessable credential/i,
    owasp: "A07:2021 Identification & Authentication",
    cwe: "CWE-521",
    attack: "T1110",
    cvss: "7.5–9.8",
    tier: "high",
    surface: "auth",
    indicators: ["vendor default accepted", "login with weak/blank password"],
    summary: "A service accepts default or trivially guessable credentials.",
  },
  {
    id: "outdated",
    label: "Vulnerable / Outdated Component",
    re: /outdated|deprecated|end[- ]of[- ]life|vulnerable (component|version|library|plugin)|known cve|\bcve-\d/i,
    owasp: "A06:2021 Vulnerable Components",
    cwe: "CWE-1035",
    attack: "T1190",
    cvss: "varies",
    tier: "medium",
    surface: "host",
    indicators: ["version in known-vulnerable range", "public exploit exists", "live check confirms"],
    summary: "A component runs a version with a known, potentially exploitable flaw.",
  },
  {
    id: "tls",
    label: "Weak TLS / Crypto",
    re: /\btls\b|\bssl\b|cipher|certificate|weak (protocol|cipher)|sslv[23]|tls ?1\.0|rc4|expired cert/i,
    owasp: "A02:2021 Cryptographic Failures",
    cwe: "CWE-326",
    attack: "T1040",
    cvss: "3.7–7.4",
    tier: "medium",
    surface: "crypto",
    indicators: ["SSLv2/3 or TLS1.0 negotiated", "RC4/NULL/EXPORT cipher", "expired/self-signed cert"],
    summary: "Weak protocols, ciphers, or certificates weaken transport confidentiality.",
  },
  {
    id: "headers",
    label: "Missing Security Headers",
    re: /missing (security )?header|x-frame-options|content-security-policy|hsts|x-content-type|referrer-policy/i,
    owasp: "A05:2021 Security Misconfiguration",
    cwe: "CWE-693",
    attack: "T1189",
    cvss: "2.0–4.3",
    tier: "low",
    surface: "web",
    indicators: ["CSP/HSTS/XFO absent", "clickjacking possible"],
    summary: "Absent hardening headers make other client-side attacks easier.",
  },
  {
    id: "info_disclosure",
    label: "Information Disclosure",
    re: /information disclosure|directory (indexing|listing)|autoindex|verbose error|stack trace|debug (mode|endpoint)|server-status|phpinfo/i,
    owasp: "A05:2021 Security Misconfiguration",
    cwe: "CWE-200",
    attack: "T1592",
    cvss: "3.7–6.5",
    tier: "low",
    surface: "info",
    indicators: ["directory listing", "stack trace / debug page", "internal paths/versions leaked"],
    summary: "The application leaks internal detail that aids further attacks.",
  },
];

/** Classify a finding's text into a vulnerability class (first, most-specific match). */
export function classifyVuln(text: string): VulnClass | null {
  const t = text || "";
  for (const c of VULN_CLASSES) if (c.re.test(t)) return c;
  return null;
}

/** Classify a finding object (title + description + optional evidence). */
export function classifyFindingVuln(f: {
  title: string;
  description?: string | null;
  evidence?: string | null;
}): VulnClass | null {
  return classifyVuln(`${f.title}\n${f.description ?? ""}\n${f.evidence ?? ""}`);
}

/** Look up a class by id. */
export function vulnClassById(id: string): VulnClass | undefined {
  return VULN_CLASSES.find((c) => c.id === id);
}
