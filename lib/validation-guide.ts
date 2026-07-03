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
  rce: {
    title: "Confirm remote code execution / command injection",
    tools: "Browser or Repeater + DevTools → Network (and an OAST canary)",
    steps: [
      "Identify the input that reaches a shell/eval (a parameter, header, filename, or field). Send a normal request and note the baseline response body + timing in DevTools → Network.",
      "TIME probe (non-destructive): append a delay for the likely OS — e.g. `;sleep 5`, `|sleep 5`, `$(sleep 5)`, or backticks `` `sleep 5` `` (URL-encode). Re-send and compare the request duration to baseline.",
      "OUT-OF-BAND probe (most reliable, needs no output): make it call a canary you control — `;nslookup <id>.oast.site` or `;curl http://<id>.oast.site` — and watch interactsh / Burp Collaborator / webhook.site for a hit FROM the target's IP.",
      "If output is reflected, run a harmless read-only command (`id`, `whoami`, `hostname`) and confirm its output appears in the response.",
    ],
    confirmsIf: "A `sleep` payload delays the response by ~5s, your OAST canary logs a lookup/HTTP hit from the server, or the output of `id`/`whoami` shows up in the response.",
    safe: "Read-only proof ONLY — sleep, DNS/HTTP callback, or id/whoami. Never read/modify files, add users, spawn a shell, or run anything destructive.",
  },
  ssti: {
    title: "Confirm server-side template injection (SSTI)",
    tools: "Browser or Repeater + DevTools → Network",
    steps: [
      "Find an input reflected into a server-rendered template (display name, subject line, profile field, custom error).",
      "Send a math probe for common engines: `{{7*7}}` (Jinja2/Twig), `${7*7}` (Freemarker/JSP-EL), `#{7*7}`, or `<%= 7*7 %>` (ERB). URL-encode as needed.",
      "Check the response: if it prints `49` instead of the literal `{{7*7}}`, the template evaluated your expression.",
      "Fingerprint the engine to be sure — e.g. `{{7*'7'}}` yields `7777777` in Jinja2 but `49` in Twig. That's enough proof.",
    ],
    confirmsIf: "The response shows the evaluated result (e.g. `49` / `7777777`) rather than the literal expression — the engine executed your input.",
    safe: "Arithmetic/identity probes only. Do NOT escalate SSTI to RCE gadgets on a target you don't own.",
  },
  lfi: {
    title: "Confirm local file inclusion / path traversal",
    tools: "Browser + DevTools → Network",
    steps: [
      "Find the parameter that names a file or path (`?page=`, `?file=`, `?template=`, `?lang=`).",
      "Request a known-safe, always-present file via traversal: `../../../../etc/passwd` (Linux) or `..\\..\\..\\windows\\win.ini` (Windows). If filtered, try `%2e%2e%2f`, double-encoding, or a null/extension trick.",
      "Read the response in DevTools → Network for the file's signature — `root:x:0:0:` for /etc/passwd, `[fonts]` for win.ini.",
      "For PHP, a read-only wrapper like `php://filter/convert.base64-encode/resource=index` returns base64 you can decode to confirm source disclosure.",
    ],
    confirmsIf: "The response returns the contents of a local file you didn't upload (e.g. /etc/passwd lines) — proving arbitrary file read.",
    safe: "Read one innocuous system file to prove reach. Don't pull secrets/keys or chain to RCE (log poisoning, wrapper-to-exec).",
  },
  xxe: {
    title: "Confirm XML external entity (XXE)",
    tools: "Repeater / DevTools → Network (and an OAST canary)",
    steps: [
      "Find an endpoint that parses XML (SOAP, SAML, sitemap/import, `Content-Type: application/xml`). Capture a normal request.",
      "Add a DOCTYPE with an external entity and reference it in a field the response echoes: `<!DOCTYPE r [<!ENTITY x SYSTEM \"file:///etc/hostname\">]>` then use `&x;` in the body.",
      "If reflected, check the response for the file's content. If blind, point the entity at your canary (`SYSTEM \"http://<id>.oast.site\"`) and watch for the inbound hit.",
    ],
    confirmsIf: "The parsed response reflects local file content, or your OAST canary receives a request from the server — the parser resolved your external entity.",
    safe: "Read a harmless file (/etc/hostname) or just OOB-ping your canary. Don't port-scan internal hosts or chain to SSRF.",
  },
  csrf: {
    title: "Confirm cross-site request forgery (CSRF)",
    tools: "Browser + a small off-origin test page",
    steps: [
      "Capture a state-changing request (e.g. change email) in DevTools → Network. Confirm it relies only on cookies — no unpredictable CSRF token and no SameSite protection.",
      "Build a minimal auto-submitting HTML form that reproduces that exact request, served from a different origin (a local .html file works).",
      "While logged into the target in the same browser, open your test page and let it submit.",
      "Refresh the target and check whether the state changed (e.g. the email updated) driven purely by the cross-site request.",
    ],
    confirmsIf: "The action succeeds from your off-site page using the victim's ambient session, with no anti-CSRF token required.",
    safe: "Change one low-risk setting on YOUR OWN test account and revert it. Never target other users.",
  },
  file_upload: {
    title: "Confirm unrestricted / dangerous file upload",
    tools: "Browser upload form + DevTools → Network",
    steps: [
      "Upload a benign allowed file first and find where it's served (note the returned URL/path).",
      "Upload a harmless file with a dangerous extension or content-type — e.g. a `.php` containing `<?php echo 'RD','PROOF'; ?>`, or a `.svg` with `<svg onload=alert(document.domain)>`.",
      "Fetch the uploaded file's URL and watch whether the server EXECUTES/renders it (PHP output, SVG script runs) instead of serving it inert.",
    ],
    confirmsIf: "The uploaded file is stored AND executed/rendered — proving code execution or stored XSS via upload, not just a file being accepted.",
    safe: "Benign marker payloads only; delete the test file afterward.",
  },
  deserialization: {
    title: "Confirm insecure deserialization",
    tools: "Repeater + OAST canary",
    steps: [
      "Identify serialized input — a base64 Java blob (starts `rO0`), a PHP `O:` string, a .NET blob (`AAEAAAD`), a viewstate/cookie/token.",
      "Confirm the format/framework from the prefix and where it's accepted.",
      "Non-destructive proof: send a well-known DETECTION gadget that only triggers an out-of-band DNS/HTTP callback (e.g. a URLDNS-style payload) — no command execution.",
      "Submit it and watch your canary for a request from the server.",
    ],
    confirmsIf: "Your OOB canary logs a callback from the target after you send the crafted object — the server deserialized attacker-controlled data.",
    safe: "Detection gadget (DNS/HTTP callback) ONLY. Do not run command/RCE gadget chains on systems you don't own.",
  },
  nosqli: {
    title: "Confirm NoSQL injection",
    tools: "Browser or Repeater + DevTools → Network",
    steps: [
      "Find a JSON or query parameter used in auth or lookups. Capture a baseline request/response.",
      "Send an operator-injection payload — JSON: `{\"username\":\"admin\",\"password\":{\"$ne\":null}}`; query-string: `username=admin&password[$ne]=` or `password[$gt]=`.",
      "Compare against the normal request in DevTools → Network — auth success, extra rows, or a changed result.",
    ],
    confirmsIf: "An operator payload (`$ne`, `$gt`, `$regex`) changes the outcome — e.g. logs in without a valid password or returns records it shouldn't.",
    safe: "Boolean operator tests on your own test account. No bulk data extraction.",
  },
  auth_bypass: {
    title: "Confirm authentication / authorization bypass",
    tools: "Browser + DevTools → Network",
    steps: [
      "Identify the protected resource and how access is enforced (login redirect, 401/403, a role flag/cookie/JWT claim).",
      "Try one bypass at a time, watching the response: request the resource directly with no auth; force-browse past the redirect; tamper a role cookie or JWT claim (`admin:false`→`true`); replay a privileged endpoint with a low-privilege session.",
      "Confirm whether protected content or actions become reachable.",
    ],
    confirmsIf: "You reach a protected page or perform a privileged action without proper authentication/authorization.",
    safe: "Use your own accounts; observe rather than damage, and report instead of pivoting.",
  },
  ato: {
    title: "Confirm account takeover (ATO)",
    tools: "Browser + DevTools → Network + two of your own test accounts",
    steps: [
      "Map the recovery / email-change / session flow in DevTools → Network.",
      "Test the specific weakness the finding names — reset token not bound to the user, OTP with no rate limit, token leaked in the response, or host-header poisoning of the reset link.",
      "Using account A as the 'attacker' against account B (both YOURS), attempt to take over B through that weakness.",
    ],
    confirmsIf: "You gain access to test account B from account A via the flaw — a reproducible takeover primitive.",
    safe: "Both accounts must be yours. Prove the primitive, then stop — never target real users.",
  },
  outdated: {
    title: "Confirm the vulnerable/outdated component",
    tools: "Browser + curl / searchsploit / a safe check script",
    steps: [
      "Confirm the exact product + version from more than one signal (DevTools → Network response headers, a `/version` endpoint, page fingerprints) — banners can lie after back-patching.",
      "Map that version to the specific CVE(s) the finding cites and verify it's actually in the vulnerable range.",
      "Run only the NON-destructive check for that CVE — a version-based nuclei template, `nmap --script`, or an `msf check` — to confirm this instance is genuinely affected.",
    ],
    confirmsIf: "The running version is confirmed in the vulnerable range AND a safe check reports the target affected — not merely a banner match.",
    safe: "Version + safe 'check' only. Don't fire the weaponized exploit unless you're explicitly authorized.",
  },
  legacy_smb: {
    title: "Confirm legacy SMB (SMBv1 / MS17-010 family)",
    tools: "nmap from your authorized machine",
    steps: [
      "Confirm the dialect: `nmap -p445 --script smb-protocols <host>` — check whether SMBv1 is offered.",
      "Run the SAFE vuln check (no exploitation): `nmap -p445 --script smb-vuln-ms17-010 <host>`.",
      "Read the script output for a VULNERABLE / NOT VULNERABLE verdict.",
    ],
    confirmsIf: "nmap reports SMBv1 enabled and/or the ms17-010 (or relevant) script marks the host VULNERABLE.",
    safe: "NSE safe-check scripts only — never fire the EternalBlue exploit on a system you don't own.",
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
