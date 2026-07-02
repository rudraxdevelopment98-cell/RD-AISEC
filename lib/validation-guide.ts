// Per-finding validation GUIDE — pure, no DB/IO. Turns the deterministic
// exploit-validation actions (lib/exploit-core.exploitActions) into a human,
// step-by-step plan: for each step it explains the technique, why it proves the
// finding, the exact command, and exactly what output CONFIRMS it. After a job
// runs, interpretOutput() reads the tool output and says "confirmed (here's the
// signal)" or "not confirmed". This is the "this vuln → this exploit → this
// result" narrative the operator sees. For authorized testing only.

import { exploitActions, type ExploitAction } from "./exploit-core";
import { classifyFindingVuln } from "./vuln-taxonomy";

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

// ── Manual browser/DevTools reproduction ────────────────────────────────────
// The "go to the site, open dev tools, and confirm it with your own eyes" guide.
// Command-line validation (above) proves it programmatically; this proves it the
// way a triager/company would — human, browser-first, so you can eyeball it and
// then confirm. For authorized testing only.

export type ManualRepro = {
  classId: string;
  title: string; // "Confirm reflected XSS in the browser"
  tools: string; // which browser surface to use (DevTools tab, Repeater, etc.)
  steps: string[]; // ordered, human steps
  confirmsIf: string; // what you should SEE if the bug is real
  safe: string; // how to keep it non-destructive
};

const REPRO: Record<string, Omit<ManualRepro, "classId">> = {
  reflected_xss: {
    title: "Confirm reflected XSS in the browser",
    tools: "Browser + DevTools → Elements/Console",
    steps: [
      "Open the affected URL and find the parameter whose value is echoed back on the page.",
      "Put a unique harmless marker in it first (e.g. `rdxss123`) and confirm it appears verbatim in the response.",
      "Replace it with a benign proof payload such as `\"><svg onload=alert(document.domain)>` (URL-encode as needed).",
      "Load the URL; in DevTools → Elements, search the DOM for your payload and check it rendered as an element, not text.",
    ],
    confirmsIf: "The alert fires (shows the site's own domain) OR your payload appears as a live element in the DOM — not HTML-escaped text.",
    safe: "Use alert(document.domain) / console.log — never data-exfil or actions. One benign popup is enough proof.",
  },
  stored_xss: {
    title: "Confirm stored XSS in the browser",
    tools: "Browser + DevTools → Elements",
    steps: [
      "Find the input that persists (name, comment, profile field) and submit a benign marker to confirm it's stored and re-rendered.",
      "Submit `\"><svg onload=alert(document.domain)>` in that field.",
      "Open the page where the value is displayed (as a victim would) in a fresh tab.",
      "Check whether the script executes on load, and inspect the DOM to confirm it rendered as an element.",
    ],
    confirmsIf: "The payload executes when the stored value is viewed by any user — proving persistence + execution.",
    safe: "Benign alert only. Remove the test entry afterwards so real users aren't affected.",
  },
  sqli: {
    title: "Confirm SQL injection in the browser/DevTools",
    tools: "Browser + DevTools → Network (or Repeater)",
    steps: [
      "Identify the parameter. Send a normal request and note the response (rows/length/timing).",
      "Send a TRUE test (e.g. `id=1 AND 1=1`) and a FALSE test (`id=1 AND 1=2`) — URL-encoded.",
      "Compare responses in DevTools → Network: a boolean-based injection shows different content/length between TRUE and FALSE.",
      "As a safe time-based check, try `1 AND SLEEP(5)` and watch the request duration in the Network tab.",
    ],
    confirmsIf: "TRUE vs FALSE return measurably different responses, or the time-based payload delays the response by ~5s.",
    safe: "Read-only boolean/time tests only. Never UNION-dump data or use stacked/DROP queries on a target you don't own.",
  },
  idor: {
    title: "Confirm IDOR / broken access control",
    tools: "Two accounts + DevTools → Network",
    steps: [
      "Log in as user A, open the object (e.g. `/api/orders/1001`), and note its id in DevTools → Network.",
      "Log in as user B (or use B's session/cookie) in a separate profile.",
      "As B, request A's object id directly (change the id in the URL/body, replay the request).",
      "Check the response: does B receive A's data (or can B modify it)?",
    ],
    confirmsIf: "User B can read or change user A's object just by changing the identifier — no authorization error.",
    safe: "Use two of YOUR OWN test accounts. Don't touch other real users' data.",
  },
  ssrf: {
    title: "Confirm SSRF (server-side request forgery)",
    tools: "Browser/Repeater + a collaborator/canary URL",
    steps: [
      "Find the parameter that takes a URL/host (webhook, image fetch, import-by-URL, PDF render…).",
      "Point it at a unique canary you control (e.g. an interactsh/Burp Collaborator or a webhook.site URL).",
      "Submit and watch your canary for an inbound request FROM the target's server IP.",
      "If that lands, try `http://169.254.169.254/latest/meta-data/` (cloud metadata) and see if the response is reflected back.",
    ],
    confirmsIf: "Your canary logs a hit from the server, or internal/metadata content comes back in the response.",
    safe: "Only read metadata to prove reach — never pivot further or hit internal services you're not authorized to.",
  },
  open_redirect: {
    title: "Confirm open redirect",
    tools: "Browser + DevTools → Network",
    steps: [
      "Find the redirect parameter (e.g. `?next=`, `?url=`, `?return=`).",
      "Set it to `https://example.com` (a domain you control or a known-safe one).",
      "Load the URL and watch DevTools → Network for a 30x Location header pointing off-site.",
    ],
    confirmsIf: "The app issues a redirect to your external domain without validation.",
    safe: "Redirect to a benign site you control; don't chain it into a phishing flow.",
  },
  cors: {
    title: "Confirm CORS misconfiguration",
    tools: "DevTools → Network / Console",
    steps: [
      "Send a request to the API with an `Origin: https://evil.example` header (DevTools, curl, or a small fetch from another origin).",
      "Inspect the response headers in DevTools → Network.",
      "Check whether `Access-Control-Allow-Origin` reflects your evil origin AND `Access-Control-Allow-Credentials: true` is set.",
    ],
    confirmsIf: "The response reflects an attacker origin with credentials allowed — a cross-site read of authed data is possible.",
    safe: "Just read the headers; no need to actually exfiltrate.",
  },
  secrets: {
    title: "Confirm the exposed secret is live",
    tools: "Browser + DevTools → Sources/Network",
    steps: [
      "Open the file/response where the key was found (JS bundle, response body) in DevTools → Sources and locate the value.",
      "Identify the provider (AWS/Google/Stripe/etc.) from the key prefix.",
      "Do a minimal READ-ONLY validity check (e.g. an identity/whoami call) — enough to prove it's active, nothing more.",
    ],
    confirmsIf: "The key authenticates (identity call succeeds) — it's a live, valid credential, not a placeholder.",
    safe: "Read-only validity check ONLY (STS get-caller-identity, token introspection). Never touch data or resources.",
  },
  subdomain_takeover: {
    title: "Confirm subdomain takeover",
    tools: "dig + browser",
    steps: [
      "Confirm the subdomain's CNAME points to a third-party service (`dig CNAME sub.target.com`).",
      "Visit the subdomain and note the service's 'no such bucket/app' fingerprint (unclaimed page).",
      "Verify the target resource is actually unclaimed on that provider (you could register it) — do NOT claim it.",
    ],
    confirmsIf: "The CNAME points to an unclaimed resource showing the provider's takeover fingerprint.",
    safe: "Prove it's claimable; do not actually claim/host content on it.",
  },
  default_creds: {
    title: "Confirm default credentials",
    tools: "Browser login form",
    steps: [
      "Open the login/admin page.",
      "Try the product's documented default pair once (e.g. admin/admin) — do not brute-force.",
      "If it logs in, screenshot the authenticated landing page as proof, then log out.",
    ],
    confirmsIf: "A default/known credential pair grants an authenticated session.",
    safe: "One documented default attempt. No password spraying, no changing settings.",
  },
  tls: {
    title: "Confirm the weak TLS is actually negotiated",
    tools: "Browser + curl",
    steps: [
      "In the browser, open the site and check DevTools → Security for the negotiated protocol/cipher.",
      "Force the weak protocol with curl (e.g. `curl --tlsv1.0 https://host`) and see if the handshake completes.",
    ],
    confirmsIf: "The server completes a handshake on the weak protocol/cipher (not just advertises it).",
    safe: "Handshake test only.",
  },
  headers: {
    title: "Confirm the missing/weak security header",
    tools: "DevTools → Network",
    steps: [
      "Load the page, open DevTools → Network, select the main document request.",
      "Read the Response Headers and confirm the header is absent (or weak) on every relevant response, not just one.",
      "Note the concrete risk it enables (e.g. no CSP → the XSS above is exploitable; no HSTS → downgrade).",
    ],
    confirmsIf: "The header is genuinely missing/misconfigured across responses — but rate this by the concrete risk it enables, not on its own.",
    safe: "Read-only; this is usually low severity unless it enables another bug.",
  },
  info_disclosure: {
    title: "Confirm the information disclosure",
    tools: "Browser + DevTools → Network",
    steps: [
      "Open the exposed path/response (stack trace, .git, backup, verbose error, debug endpoint).",
      "Confirm it returns sensitive content (source, credentials, internal paths, versions) and not a 404/placeholder.",
      "Capture the exact request → response as evidence.",
    ],
    confirmsIf: "The endpoint really serves sensitive internal content to an unauthenticated request.",
    safe: "Read only what proves it; don't hoard dumps.",
  },
};

const REPRO_FALLBACK: Omit<ManualRepro, "classId"> = {
  title: "Confirm it by hand in the browser",
  tools: "Browser + DevTools → Network",
  steps: [
    "Reproduce the exact request from the finding in the browser (or DevTools → Network → replay).",
    "Observe the response for the concrete condition the finding claims.",
    "Capture request + response as evidence, then mark it confirmed only if you personally saw the issue.",
  ],
  confirmsIf: "You can reproduce the claimed condition on the live target yourself.",
  safe: "Keep tests read-only / non-destructive on authorized targets only.",
};

/** Human, browser-first reproduction steps so an operator can confirm a finding
 *  with their own eyes (complements the command-line validationPlan). */
export function manualRepro(finding: {
  title: string;
  description?: string | null;
  owasp?: string | null;
}): ManualRepro {
  const cls = classifyFindingVuln({
    title: finding.title,
    description: finding.description ?? "",
  });
  const id = cls?.id ?? "";
  const body = REPRO[id] ?? REPRO_FALLBACK;
  return { classId: id || "generic", ...body };
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
