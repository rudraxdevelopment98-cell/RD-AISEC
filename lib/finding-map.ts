// Deterministic mapping of a finding to security frameworks (no AI).
//
// Given a finding's tool, title, description and severity, classifyFinding
// returns the MITRE ATT&CK tactic and OWASP Top 10 category it best fits, using
// plain keyword rules. Pure + unit-testable — no DB, no I/O. IDs returned here
// match the entries in data/frameworks.ts so the UI can render their labels.

import { MITRE_TACTICS, OWASP_TOP10 } from "@/data/frameworks";

export type FrameworkTags = { attack: string; owasp: string };

export type ClassifyInput = {
  tool?: string | null;
  title?: string | null;
  description?: string | null;
  severity?: string | null;
};

// Keyword → OWASP id. First match wins, so order most-specific first.
const OWASP_RULES: { re: RegExp; id: string }[] = [
  { re: /\bssrf\b|server-side request forgery/i, id: "A10" },
  { re: /sql\s*injection|sqli\b|nosql injection|command injection|os command|ldap injection|template injection|\bssti\b|\bxxe\b|xml external entity|\binjection\b|\bxss\b|cross[- ]site scripting|crlf injection|host header injection/i, id: "A03" },
  { re: /deserializ|insecure update|integrity (failure|check)|unsigned|supply chain|ci\/cd|subresource integrity/i, id: "A08" },
  { re: /broken access|access control|\bidor\b|insecure direct object|directory traversal|path traversal|\blfi\b|\brfi\b|local file inclusion|remote file inclusion|forced browsing|csrf|cross[- ]site request forgery|privilege escalation|open redirect|unrestricted (file )?upload/i, id: "A01" },
  { re: /\bcve-|outdated|deprecated|end[- ]of[- ]life|vulnerable (component|version|library|plugin|theme)|known vulnerab|out of date/i, id: "A06" },
  { re: /\btls\b|\bssl\b|cipher|certificate|cleartext|plaintext|weak (crypto|hash|encryption)|crypto(graphic)? failure|http (instead of|not) https|heartbleed|poodle|\brc4\b|\b3des\b|md5|sslv[23]|tls\s?1\.[01]/i, id: "A02" },
  { re: /auth(entication)? (failure|bypass|weak)|default (account|credential|password)|weak password|brute[- ]force|session (fixation|management)|missing mfa|2fa|\bjwt\b|exposed (api )?(key|token|secret)|hardcoded (password|secret)/i, id: "A07" },
  { re: /logging|monitoring|audit (trail|log)|no alerting/i, id: "A09" },
  { re: /misconfig|default (file|page|install|config)|directory (indexing|listing)|verbose error|stack trace|debug (mode|enabled)|missing (security )?header|x-frame-options|content-security|hsts|cors|exposed (config|panel|dashboard|\.env|\.git|backup|phpinfo|swagger|actuator)|open (port|service|redirect)|http methods|\bwaf\b/i, id: "A05" },
];

// Keyword → ATT&CK tactic id. First match wins.
const ATTACK_RULES: { re: RegExp; id: string }[] = [
  { re: /sql\s*injection|sqli\b|command injection|os command|\brce\b|remote code|code execution|exploit|upload (shell|webshell)|web shell|authentication bypass|auth bypass|\bssti\b|\bxxe\b|deserializ/i, id: "TA0001" }, // Initial Access
  { re: /privilege escalation|sudo|setuid|escalat|\bidor\b|access control/i, id: "TA0004" }, // Privilege Escalation
  { re: /default (account|credential|password)|weak password|brute[- ]force|credential|password (exposed|leak)|secret (exposed|leak)|api key|token leak|\bjwt\b|hardcoded/i, id: "TA0006" }, // Credential Access
  { re: /exfiltrat|data (leak|exposure|exposed)|backup (file|exposed)|\.env|\.git|database dump|directory (indexing|listing)|zone transfer/i, id: "TA0010" }, // Exfiltration
  { re: /lateral movement|\bsmb\b|rdp share|pivot/i, id: "TA0008" }, // Lateral Movement
];

function firstMatch(rules: { re: RegExp; id: string }[], hay: string): string {
  for (const r of rules) if (r.re.test(hay)) return r.id;
  return "";
}

/**
 * Classify a finding into ATT&CK tactic + OWASP category. Returns "" for either
 * dimension when nothing matches (e.g. a benign open-port/info finding gets
 * Discovery but no OWASP category).
 */
// Infer which tool produced a finding from its text — used for backfilling old
// findings that predate the stored framework tags (they have no `tool`).
function inferTool(hay: string): string {
  const h = hay.toLowerCase();
  if (/\bnmap\b|open port \d/.test(h)) return "nmap";
  if (/\bnuclei\b|template/.test(h)) return "nuclei";
  if (/\bsqlmap\b/.test(h)) return "sqlmap";
  if (/\bnikto\b/.test(h)) return "nikto";
  if (/\bhttpx\b|live http/.test(h)) return "httpx";
  if (/\bsslscan\b|tls\/ssl|cipher|heartbleed/.test(h)) return "sslscan";
  if (/\bwpscan\b|wordpress/.test(h)) return "wpscan";
  if (/\bgobuster\b|discovered paths/.test(h)) return "gobuster";
  if (/\bwhatweb\b|technology stack/.test(h)) return "whatweb";
  if (/\bwafw00f\b|\bwaf\b/.test(h)) return "wafw00f";
  if (/\bmasscan\b/.test(h)) return "masscan";
  if (/\benum4linux\b|smb enumeration/.test(h)) return "enum4linux";
  if (/\bdnsrecon\b|zone transfer/.test(h)) return "dnsrecon";
  if (/\bamass\b|subdomain/.test(h)) return "amass";
  if (/\bwhois\b/.test(h)) return "whois";
  if (/\bdig\b|dns record/.test(h)) return "dig";
  return "";
}

export function classifyFinding(input: ClassifyInput): FrameworkTags {
  const hay = `${input.tool ?? ""} ${input.title ?? ""} ${input.description ?? ""}`;
  const tool = (input.tool ?? "").toLowerCase() || inferTool(hay);

  let owasp = firstMatch(OWASP_RULES, hay);
  let attack = firstMatch(ATTACK_RULES, hay);

  // Tool-level defaults when keywords didn't pin it down. Recon/scan tools map
  // to Discovery; their findings still get a sensible OWASP bucket.
  const DISCOVERY_TOOLS = new Set([
    "nmap", "httpx", "whois", "dig", "nuclei", "nikto", "sslscan", "wpscan",
    "gobuster", "whatweb", "wafw00f", "masscan", "enum4linux", "dnsrecon",
    "dnsenum", "amass", "theharvester",
  ]);
  if (!attack && DISCOVERY_TOOLS.has(tool)) attack = "TA0007"; // Discovery
  if (!owasp) {
    if (tool === "sslscan") owasp = "A02"; // crypto
    else if (tool === "nikto" || tool === "wpscan" || tool === "nuclei" || tool === "gobuster" || tool === "whatweb") {
      owasp = "A05"; // misconfiguration / exposure
    } else if (tool === "enum4linux") owasp = "A05";
  }

  return { attack, owasp };
}

const ATTACK_BY_ID = new Map(MITRE_TACTICS.map((t) => [t.id, t.name]));
const OWASP_BY_ID = new Map(OWASP_TOP10.map((o) => [o.id, o.name]));

export function attackLabel(id?: string | null): string | null {
  if (!id) return null;
  const name = ATTACK_BY_ID.get(id);
  return name ? `${id} ${name}` : id;
}

export function owaspLabel(id?: string | null): string | null {
  if (!id) return null;
  const name = OWASP_BY_ID.get(id);
  return name ? `${id} ${name}` : id;
}

/** Apply framework tags to a batch of finding-shaped objects (adds attack/owasp). */
export function tagFindings<T extends ClassifyInput>(
  findings: T[],
  tool?: string | null,
): (T & FrameworkTags)[] {
  return findings.map((f) => ({
    ...f,
    ...classifyFinding({ ...f, tool: f.tool ?? tool }),
  }));
}
