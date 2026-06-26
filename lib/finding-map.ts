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
  { re: /sql\s*injection|sqli\b|nosql injection|command injection|os command|ldap injection|template injection|\binjection\b|\bxss\b|cross[- ]site scripting/i, id: "A03" },
  { re: /deserializ|insecure update|integrity (failure|check)|unsigned|supply chain|ci\/cd/i, id: "A08" },
  { re: /broken access|access control|idor|insecure direct object|directory traversal|path traversal|\blfi\b|\brfi\b|forced browsing|csrf|cross[- ]site request forgery|privilege escalation/i, id: "A01" },
  { re: /\bcve-|outdated|deprecated|end[- ]of[- ]life|vulnerable (component|version|library|plugin)|known vulnerab/i, id: "A06" },
  { re: /tls|ssl|cipher|certificate|cleartext|plaintext|weak (crypto|hash|encryption)|crypto(graphic)? failure|http (instead of|not) https/i, id: "A02" },
  { re: /auth(entication)? (failure|bypass|weak)|default (account|credential|password)|weak password|brute[- ]force|session (fixation|management)|missing mfa|2fa/i, id: "A07" },
  { re: /logging|monitoring|audit (trail|log)|no alerting/i, id: "A09" },
  { re: /misconfig|default (file|page|install|config)|directory (indexing|listing)|verbose error|stack trace|debug (mode|enabled)|missing (security )?header|x-frame-options|cors|exposed (config|panel|dashboard|\.env|backup)|open (port|service|redirect)/i, id: "A05" },
];

// Keyword → ATT&CK tactic id. First match wins.
const ATTACK_RULES: { re: RegExp; id: string }[] = [
  { re: /sql\s*injection|sqli\b|command injection|os command|rce|remote code|exploit|upload (shell|webshell)|authentication bypass|auth bypass/i, id: "TA0001" }, // Initial Access
  { re: /privilege escalation|sudo|setuid|escalat/i, id: "TA0004" }, // Privilege Escalation
  { re: /default (account|credential|password)|weak password|brute[- ]force|credential|password (exposed|leak)|secret (exposed|leak)|api key|token leak/i, id: "TA0006" }, // Credential Access
  { re: /exfiltrat|data (leak|exposure|exposed)|backup (file|exposed)|\.env|database dump/i, id: "TA0010" }, // Exfiltration
  { re: /lateral movement|smb|rdp share|pivot/i, id: "TA0008" }, // Lateral Movement
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
export function classifyFinding(input: ClassifyInput): FrameworkTags {
  const tool = (input.tool ?? "").toLowerCase();
  const hay = `${input.tool ?? ""} ${input.title ?? ""} ${input.description ?? ""}`;

  let owasp = firstMatch(OWASP_RULES, hay);
  let attack = firstMatch(ATTACK_RULES, hay);

  // Tool-level defaults when keywords didn't pin it down.
  if (!attack) {
    if (tool === "nmap" || tool === "httpx" || tool === "whois" || tool === "dig") {
      attack = "TA0007"; // Discovery — recon/enumeration tools
    } else if (tool === "nuclei" || tool === "nikto" || tool === "sslscan" || tool === "wpscan") {
      attack = "TA0007"; // Discovery — vuln/exposure enumeration
    }
  }
  if (!owasp) {
    // sslscan/TLS-focused tools default to crypto; web scanners to misconfig.
    if (tool === "sslscan") owasp = "A02";
    else if (tool === "nikto" || tool === "wpscan" || tool === "nuclei") owasp = "A05";
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
