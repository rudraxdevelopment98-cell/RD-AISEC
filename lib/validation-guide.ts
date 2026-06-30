// Per-finding validation GUIDE — pure, no DB/IO. Turns the deterministic
// exploit-validation actions (lib/exploit-core.exploitActions) into a human,
// step-by-step plan: for each step it explains the technique, why it proves the
// finding, the exact command, and exactly what output CONFIRMS it. After a job
// runs, interpretOutput() reads the tool output and says "confirmed (here's the
// signal)" or "not confirmed". This is the "this vuln → this exploit → this
// result" narrative the operator sees. For authorized testing only.

import { exploitActions, type ExploitAction } from "./exploit-core";

export type StepGuide = {
  technique: string; // short name of the check
  why: string; // why this proves (or disproves) the finding
  confirmsIf: string; // plain-language success signal
  confirmRe: RegExp; // machine signal in the tool output
  proves: boolean; // true = a positive result PROVES exploitability; false = supporting signal only
};

// Per-tool guidance. Keyed by the tool the action runs. `custom` is disambiguated
// by the command (msfconsole / mosquitto / etc.) in guideForAction().
const TOOL_GUIDE: Record<string, StepGuide> = {
  sqlmap: {
    technique: "SQL injection confirmation (sqlmap)",
    why: "If the parameter is injectable, sqlmap negotiates a working payload and identifies the back-end DBMS — that is proof, not a guess.",
    confirmsIf: "sqlmap reports the parameter is injectable and names the DBMS.",
    confirmRe: /is vulnerable|injectable|back-end DBMS|parameter '.*' is/i,
    proves: true,
  },
  dalfox: {
    technique: "XSS trigger (dalfox)",
    why: "dalfox injects and verifies payloads; a triggered PoC means the script actually executes in the page context.",
    confirmsIf: "dalfox prints a [POC]/triggered/verified result.",
    confirmRe: /\[POC\]|triggered|verified|reflected/i,
    proves: true,
  },
  nuclei: {
    technique: "Templated check (nuclei)",
    why: "A template match — especially one that extracts concrete data — corroborates the issue against the live target.",
    confirmsIf: "a high/critical template matches (ideally extracting data).",
    confirmRe: /\b(critical|high)\b|matched|extracted/i,
    proves: false,
  },
  nmap: {
    technique: "Vulnerability NSE scripts (nmap --script vuln)",
    why: "Safe NSE vuln scripts probe the service and report VULNERABLE / LIKELY VULNERABLE when the condition is met.",
    confirmsIf: "an NSE script reports VULNERABLE or 'likely vulnerable'.",
    confirmRe: /VULNERABLE|likely vulnerable|State: VULNERABLE/i,
    proves: true,
  },
  wpscan: {
    technique: "WordPress enumeration (wpscan)",
    why: "wpscan cross-references the detected version/plugins against known vulnerabilities.",
    confirmsIf: "wpscan lists a known vulnerability for the version/plugin.",
    confirmRe: /\[!\]|vulnerab|known vulnerab|title:/i,
    proves: false,
  },
  sslscan: {
    technique: "TLS posture (sslscan)",
    why: "Confirms whether the server actually negotiates weak protocols/ciphers (not just advertises them).",
    confirmsIf: "SSLv2/SSLv3/TLS1.0 or a weak/NULL/RC4 cipher is accepted.",
    confirmRe: /SSLv2|SSLv3|TLSv1\.0|RC4|NULL|EXPORT|weak/i,
    proves: true,
  },
  searchsploit: {
    technique: "Public exploit lookup (searchsploit)",
    why: "Finds whether a public exploit exists for the product/version — useful context, but running it is what proves impact.",
    confirmsIf: "searchsploit lists a matching exploit (then validate it).",
    confirmRe: /\| *\/|Exploit Title|Shellcode/i,
    proves: false,
  },
  crackmapexec: {
    technique: "SMB posture (crackmapexec)",
    why: "Confirms exploitable SMB conditions (signing disabled, SMBv1) and validates any credentials.",
    confirmsIf: "signing:False, SMBv1:True, or a [+] valid login appears.",
    confirmRe: /signing:\s*False|SMBv1:\s*True|\[\+\]/i,
    proves: true,
  },
  onesixtyone: {
    technique: "SNMP community check (onesixtyone)",
    why: "A device answering a default community string proves SNMP information exposure.",
    confirmsIf: "the host replies with a community string in [brackets].",
    confirmRe: /\[[^\]]+\]/,
    proves: true,
  },
  snmpcheck: {
    technique: "SNMP enumeration (snmp-check)",
    why: "Successful enumeration proves the community string exposes device data.",
    confirmsIf: "system/network information is returned.",
    confirmRe: /System information|Hostname\s*:|Connection successful/i,
    proves: true,
  },
};

const MSF_GUIDE: StepGuide = {
  technique: "Metasploit check module",
  why: "The auxiliary check probes the target without exploiting and reports VULNERABLE when the condition holds.",
  confirmsIf: "the module prints 'is vulnerable' / VULNERABLE.",
  confirmRe: /VULNERABLE|is vulnerable|appears to be vulnerable/i,
  proves: true,
};

function guideForAction(a: ExploitAction): StepGuide {
  if (a.tool === "custom" && /msfconsole/i.test(a.args)) return MSF_GUIDE;
  return (
    TOOL_GUIDE[a.tool] ?? {
      technique: `Run ${a.tool}`,
      why: "Probes the target for the condition behind this finding.",
      confirmsIf: "the tool reports the issue against the live target.",
      confirmRe: /vulnerab|confirmed|success|open|found/i,
      proves: false,
    }
  );
}

export type ValidationStep = {
  technique: string;
  why: string;
  tool: string;
  target: string;
  command: string; // human-readable command line
  confirmsIf: string;
  proves: boolean;
};

export type ValidationPlan = {
  steps: ValidationStep[];
  note: string;
};

function commandLine(a: ExploitAction): string {
  if (a.tool === "custom") return a.args;
  return `${a.tool} ${a.args ? a.args + " " : ""}${a.target}`.trim();
}

/** Build the ordered validation plan for a finding: each step explains itself. */
export function validationPlan(finding: {
  title: string;
  description?: string | null;
  severity?: string | null;
  owasp?: string | null;
}): ValidationPlan {
  const actions = exploitActions(finding);
  const steps: ValidationStep[] = actions.map((a) => {
    const g = guideForAction(a);
    return {
      technique: g.technique,
      why: g.why,
      tool: a.tool,
      target: a.target,
      command: commandLine(a),
      confirmsIf: g.confirmsIf,
      proves: g.proves,
    };
  });
  const note =
    steps.length === 0
      ? "No automated validation is defined for this finding type — validate it by hand, then mark it confirmed."
      : "Run these on an authorized target. A 'proves' step that succeeds confirms exploitability; supporting steps add evidence.";
  return { steps, note };
}

export type Interpretation = { confirmed: boolean; proves: boolean; signal: string };

/**
 * Interpret a finished job's output for a validation step: did it CONFIRM the
 * finding? `proves` distinguishes a confirming result (exploitability proven)
 * from a supporting signal. Reads the same per-tool signals the guide promised.
 */
export function interpretOutput(tool: string, args: string, output: string): Interpretation {
  const g = tool === "custom" && /msfconsole/i.test(args) ? MSF_GUIDE : TOOL_GUIDE[tool];
  if (!g) {
    const hit = /vulnerab|confirmed|VULNERABLE/i.test(output);
    return { confirmed: hit, proves: false, signal: hit ? "a vulnerability signal was found" : "no clear signal" };
  }
  const confirmed = g.confirmRe.test(output);
  return {
    confirmed,
    proves: g.proves && confirmed,
    signal: confirmed ? g.confirmsIf : `no match for: ${g.confirmsIf}`,
  };
}
