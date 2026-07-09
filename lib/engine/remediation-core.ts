// Engine remediation engine — turns a finding into a concrete, prioritized fix
// plan: root cause, ordered fix steps, an effort estimate, how to verify the fix,
// authoritative references, and a copy-pasteable code/config snippet where one
// helps. Keyed off the vuln taxonomy (25 classes) with a sensible generic
// fallback by OWASP category, so every finding gets an actionable plan — not a
// one-liner. Pure (no DB/IO), client-safe, unit-tested.

import { classifyFindingVuln, type VulnClass } from "@/lib/vuln-taxonomy";

export type Effort = "Quick" | "Moderate" | "Involved";

export type Reference = { label: string; url: string };

export type Snippet = { lang: string; label: string; code: string };

export type RemediationPlan = {
  classId: string | null;
  classLabel: string;
  rootCause: string;
  fixSteps: string[];
  preventive: string[];
  verifySteps: string[];
  effort: Effort;
  references: Reference[];
  snippet?: Snippet;
};

type Template = {
  rootCause: string;
  fixSteps: string[];
  preventive?: string[];
  verify: string[];
  effort: Effort;
  refs?: Reference[];
  snippet?: Snippet;
};

const OWASP_REF = (id: string, url: string): Reference => ({ label: `OWASP ${id}`, url });
const CWE_REF = (cwe: string): Reference => ({ label: cwe, url: `https://cwe.mitre.org/data/definitions/${cwe.replace(/\D/g, "")}.html` });

// Per-class remediation templates. Content is deliberately concrete.
const TEMPLATES: Record<string, Template> = {
  sqli: {
    rootCause: "User input is concatenated into a SQL query, so an attacker can change the query's structure.",
    fixSteps: [
      "Replace string-built queries with parameterized queries / prepared statements — never concatenate input into SQL.",
      "Use an ORM or query builder that parameterizes by default; audit any raw-SQL escape hatches.",
      "Apply least-privilege to the DB account (no DDL/superuser for the app).",
      "Validate/allow-list values that can't be parameterized (e.g. column/sort names).",
    ],
    preventive: ["Add a CI check that flags string-formatted SQL.", "Enable DB query logging + anomaly alerts."],
    verify: [
      "Re-run sqlmap against the parameter — it should report no injection.",
      "Confirm error messages no longer leak SQL/DB details.",
    ],
    effort: "Moderate",
    refs: [OWASP_REF("A03 Injection", "https://owasp.org/Top10/A03_2021-Injection/"), CWE_REF("CWE-89"), { label: "OWASP SQLi Prevention Cheat Sheet", url: "https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html" }],
    snippet: { lang: "python", label: "Parameterized query", code: "# BAD:  cur.execute(\"SELECT * FROM users WHERE id = '\" + uid + \"'\")\n# GOOD:\ncur.execute(\"SELECT * FROM users WHERE id = %s\", (uid,))" },
  },
  rce: {
    rootCause: "Attacker-controlled input reaches a code/command interpreter and is executed on the server.",
    fixSteps: [
      "Remove the dynamic exec/shell call; use a safe library API for the task instead of shelling out.",
      "If a subprocess is unavoidable, pass arguments as an argv array (never a shell string) and allow-list the command + flags.",
      "Strictly validate/allow-list any input that influences the call; reject everything else.",
      "Run the service as an unprivileged user and sandbox it (seccomp/AppArmor/container).",
    ],
    preventive: ["Patch the affected component to a fixed release.", "Add egress filtering so a shell can't call home."],
    verify: ["Re-send the original payload — command output / OOB callback must no longer trigger.", "Confirm no delay/sleep primitive executes."],
    effort: "Involved",
    refs: [OWASP_REF("A03 Injection", "https://owasp.org/Top10/A03_2021-Injection/"), CWE_REF("CWE-94"), { label: "OWASP Command Injection Defense", url: "https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html" }],
    snippet: { lang: "python", label: "Argv, not shell", code: "# BAD:  os.system(f\"ping {host}\")\n# GOOD:\nimport subprocess, shlex\nif host in ALLOWED_HOSTS:\n    subprocess.run([\"ping\", \"-c\", \"1\", host], shell=False, timeout=5)" },
  },
  reflected_xss: {
    rootCause: "Untrusted input is reflected into an HTML/JS response without context-correct output encoding.",
    fixSteps: [
      "Contextually output-encode all untrusted data (HTML, attribute, JS, URL, CSS contexts differ).",
      "Prefer a framework that auto-escapes (React/Angular/modern templating); avoid innerHTML/dangerouslySetInnerHTML.",
      "Sanitize rich HTML with a vetted library (DOMPurify) if you must allow markup.",
      "Add a strict Content-Security-Policy as defense-in-depth.",
    ],
    verify: ["Re-inject the marker payload — it should render as inert text, not execute.", "Confirm CSP blocks inline script."],
    effort: "Moderate",
    refs: [OWASP_REF("A03 Injection", "https://owasp.org/Top10/A03_2021-Injection/"), CWE_REF("CWE-79"), { label: "OWASP XSS Prevention Cheat Sheet", url: "https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html" }],
    snippet: { lang: "html", label: "CSP header", code: "Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'" },
  },
  idor: {
    rootCause: "The app returns an object by id without checking the caller is authorized for that specific object.",
    fixSteps: [
      "Enforce per-object authorization on every request (does THIS user own/what-can-access THIS id?).",
      "Scope queries by the authenticated principal (WHERE owner_id = :currentUser), not by the id alone.",
      "Use unguessable identifiers (UUIDs) as defense-in-depth — but never as the only control.",
      "Centralize access checks in middleware/policy so no endpoint can forget them.",
    ],
    verify: ["With account A's session, request account B's object id — a fixed app returns 403/404.", "Repeat across every object type."],
    effort: "Moderate",
    refs: [OWASP_REF("A01 Broken Access Control", "https://owasp.org/Top10/A01_2021-Broken_Access_Control/"), CWE_REF("CWE-639")],
  },
  ssrf: {
    rootCause: "The server fetches a URL derived from user input, letting an attacker reach internal services or metadata.",
    fixSteps: [
      "Allow-list the destinations the server may fetch (scheme + host); reject everything else.",
      "Resolve the hostname and block private/link-local ranges (169.254.169.254, 10/8, 127/8, ::1) — re-check after redirects.",
      "Disable unneeeded URL schemes (file:, gopher:, dict:).",
      "Send outbound fetches through an egress proxy that enforces the allow-list.",
    ],
    verify: ["Re-run the OOB probe to an internal/metadata URL — it must be blocked.", "Confirm redirects can't bypass the check."],
    effort: "Moderate",
    refs: [OWASP_REF("A10 SSRF", "https://owasp.org/Top10/A10_2021-Server-Side_Request_Forgery_%28SSRF%29/"), CWE_REF("CWE-918")],
  },
  default_creds: {
    rootCause: "A service is reachable with vendor-default or weak credentials.",
    fixSteps: [
      "Change the default credentials immediately to a strong, unique secret.",
      "Disable or rename default/administrative accounts where possible.",
      "Restrict the admin interface to trusted networks / VPN.",
      "Enable MFA on administrative access.",
    ],
    verify: ["Attempt the default login again — it must fail.", "Confirm the admin panel isn't reachable from the internet."],
    effort: "Quick",
    refs: [OWASP_REF("A07 Auth Failures", "https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/"), CWE_REF("CWE-1392")],
  },
  outdated: {
    rootCause: "A component is running a version with a publicly known vulnerability.",
    fixSteps: [
      "Upgrade the component to a patched release (check the vendor advisory for the fixed version).",
      "If you can't upgrade immediately, apply the vendor's documented mitigation / virtual patch.",
      "Inventory where else the component is used and patch consistently.",
    ],
    preventive: ["Adopt SCA/dependabot to flag vulnerable dependencies.", "Track an SBOM so you can find affected components fast."],
    verify: ["Re-scan — the version banner should reflect the fixed release and the CVE check should clear."],
    effort: "Quick",
    refs: [OWASP_REF("A06 Vulnerable Components", "https://owasp.org/Top10/A06_2021-Vulnerable_and_Outdated_Components/"), CWE_REF("CWE-1035")],
  },
  tls: {
    rootCause: "The TLS configuration allows weak protocols/ciphers or presents an invalid certificate.",
    fixSteps: [
      "Disable SSLv3/TLS 1.0/1.1; allow only TLS 1.2+ (prefer 1.3).",
      "Remove weak ciphers (RC4, 3DES, export, NULL); prefer AEAD suites.",
      "Install a valid, current certificate from a trusted CA; fix chain issues.",
      "Enable HSTS once HTTPS is solid.",
    ],
    verify: ["Re-run sslscan/testssl — only strong protocols/ciphers should remain.", "Confirm the certificate chain validates."],
    effort: "Quick",
    refs: [CWE_REF("CWE-326"), { label: "Mozilla TLS config generator", url: "https://ssl-config.mozilla.org/" }],
    snippet: { lang: "nginx", label: "Modern TLS (nginx)", code: "ssl_protocols TLSv1.2 TLSv1.3;\nssl_prefer_server_ciphers off;\nadd_header Strict-Transport-Security \"max-age=63072000\" always;" },
  },
  headers: {
    rootCause: "Security response headers are missing, weakening browser-side defenses.",
    fixSteps: [
      "Add Content-Security-Policy (start report-only, then enforce).",
      "Add X-Content-Type-Options: nosniff and a Referrer-Policy.",
      "Add Strict-Transport-Security on HTTPS sites.",
      "Set a restrictive Permissions-Policy.",
    ],
    verify: ["Re-check response headers — the expected set should be present.", "Confirm CSP doesn't break the app in report-only first."],
    effort: "Quick",
    refs: [{ label: "OWASP Secure Headers", url: "https://owasp.org/www-project-secure-headers/" }],
    snippet: { lang: "http", label: "Baseline headers", code: "Content-Security-Policy: default-src 'self'\nX-Content-Type-Options: nosniff\nReferrer-Policy: strict-origin-when-cross-origin\nStrict-Transport-Security: max-age=31536000" },
  },
  secrets: {
    rootCause: "A credential/API key/token is exposed in code, config, or a response.",
    fixSteps: [
      "Revoke and rotate the exposed secret immediately — assume it is compromised.",
      "Move secrets to a secrets manager / environment; remove them from source and history.",
      "Purge the secret from git history (filter-repo/BFG) and any caches/artifacts.",
      "Add pre-commit + CI secret scanning to prevent recurrence.",
    ],
    verify: ["Confirm the old secret no longer authenticates.", "Re-scan the repo/response — the secret should be gone."],
    effort: "Moderate",
    refs: [OWASP_REF("A07 Auth Failures", "https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/"), CWE_REF("CWE-798")],
  },
  info_disclosure: {
    rootCause: "The app leaks internal details (stack traces, versions, paths, debug data) useful to an attacker.",
    fixSteps: [
      "Disable debug mode and verbose errors in production; return generic error pages.",
      "Remove version banners / server tokens where feasible.",
      "Restrict access to backup, .git, config, and admin files.",
    ],
    verify: ["Trigger an error — it should be generic, no stack trace.", "Confirm sensitive files return 403/404."],
    effort: "Quick",
    refs: [OWASP_REF("A05 Misconfiguration", "https://owasp.org/Top10/A05_2021-Security_Misconfiguration/"), CWE_REF("CWE-200")],
  },
  csrf: {
    rootCause: "State-changing requests are accepted without proof they came from the app, so a third-party site can forge them.",
    fixSteps: [
      "Add anti-CSRF tokens (synchronizer or double-submit) to all state-changing requests.",
      "Set SameSite=Lax/Strict on session cookies.",
      "Prefer framework CSRF middleware; verify Origin/Referer as defense-in-depth.",
    ],
    verify: ["Replay a state-changing request cross-site without the token — it must be rejected."],
    effort: "Moderate",
    refs: [OWASP_REF("A01 Broken Access Control", "https://owasp.org/Top10/A01_2021-Broken_Access_Control/"), CWE_REF("CWE-352")],
  },
  open_redirect: {
    rootCause: "A redirect target is taken from user input, enabling phishing and token theft.",
    fixSteps: [
      "Allow-list permitted redirect destinations; reject external/absolute URLs.",
      "Use relative paths or a server-side map of id→URL instead of raw URLs.",
    ],
    verify: ["Attempt a redirect to an external domain — it must be blocked."],
    effort: "Quick",
    refs: [CWE_REF("CWE-601")],
  },
  auth_bypass: {
    rootCause: "Authentication can be skipped or forged (weak session/JWT handling, logic flaw).",
    fixSteps: [
      "Enforce authentication server-side on every protected route; never trust client flags.",
      "Verify JWT signature + algorithm (reject alg:none); validate exp/aud/iss.",
      "Regenerate session ids on login; bind sessions to strong, random tokens.",
      "Add MFA for sensitive access.",
    ],
    verify: ["Attempt the bypass again — access must be denied.", "Confirm forged/none-alg JWTs are rejected."],
    effort: "Involved",
    refs: [OWASP_REF("A07 Auth Failures", "https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/"), CWE_REF("CWE-287")],
  },
};

// Generic fallback plans by OWASP category prefix (A01…A10), used when a class
// has no bespoke template.
function genericForOwasp(owasp: string): Pick<Template, "fixSteps" | "verify" | "effort"> {
  if (/A01/.test(owasp)) return { fixSteps: ["Enforce server-side authorization on every request, scoped to the authenticated user."], verify: ["Confirm cross-user/cross-object access is denied."], effort: "Moderate" };
  if (/A02/.test(owasp)) return { fixSteps: ["Use strong, current cryptography; encrypt sensitive data in transit and at rest; rotate keys."], verify: ["Confirm weak crypto is gone and data is encrypted."], effort: "Moderate" };
  if (/A05/.test(owasp)) return { fixSteps: ["Harden the configuration: disable debug, remove defaults, restrict sensitive endpoints."], verify: ["Re-scan configuration; confirm the misconfig is resolved."], effort: "Quick" };
  if (/A06/.test(owasp)) return { fixSteps: ["Upgrade the affected component to a fixed release; apply the vendor mitigation if you can't."], verify: ["Re-scan; confirm the fixed version."], effort: "Quick" };
  return { fixSteps: ["Apply the vendor/framework-recommended fix for this weakness and validate input/output at the boundary."], verify: ["Re-test the original vector; confirm it no longer works."], effort: "Moderate" };
}

/** Build a full remediation plan for a finding. */
export function remediationPlan(f: { title: string; description?: string | null; recommendation?: string | null; severity?: string }): RemediationPlan {
  const cls = classifyFindingVuln({ title: f.title, description: f.description });
  const tpl = cls ? TEMPLATES[cls.id] : undefined;

  if (cls && tpl) {
    return {
      classId: cls.id,
      classLabel: cls.label,
      rootCause: tpl.rootCause,
      fixSteps: tpl.fixSteps,
      preventive: tpl.preventive ?? defaultPreventive(cls),
      verifySteps: tpl.verify,
      effort: tpl.effort,
      references: dedupeRefs([...(tpl.refs ?? []), OWASP_REF(cls.owasp, owaspUrl(cls.owasp)), CWE_REF(cls.cwe)]),
      snippet: tpl.snippet,
    };
  }

  if (cls) {
    const g = genericForOwasp(cls.owasp);
    return {
      classId: cls.id,
      classLabel: cls.label,
      rootCause: cls.summary,
      fixSteps: mergeRec(f.recommendation, g.fixSteps),
      preventive: defaultPreventive(cls),
      verifySteps: g.verify,
      effort: g.effort,
      references: dedupeRefs([OWASP_REF(cls.owasp, owaspUrl(cls.owasp)), CWE_REF(cls.cwe)]),
    };
  }

  // Unclassified: still give a usable plan from the stored recommendation.
  return {
    classId: null,
    classLabel: "General weakness",
    rootCause: "The finding indicates a security weakness that should be remediated at the input/output boundary or via configuration.",
    fixSteps: mergeRec(f.recommendation, ["Apply the recommended fix, validate input and encode output, and restrict exposure to what's necessary."]),
    preventive: ["Add a regression test that fails if the issue reappears."],
    verifySteps: ["Re-test the original vector and confirm it no longer works."],
    effort: "Moderate",
    references: [{ label: "OWASP Top 10", url: "https://owasp.org/www-project-top-ten/" }],
  };
}

function defaultPreventive(cls: VulnClass): string[] {
  return [`Add a test/CI guard for ${cls.label.toLowerCase()}.`, "Cover this class in secure-coding guidelines and code review."];
}
function mergeRec(rec: string | null | undefined, steps: string[]): string[] {
  const r = (rec ?? "").trim();
  return r ? [r, ...steps] : steps;
}
function dedupeRefs(refs: Reference[]): Reference[] {
  const seen = new Set<string>();
  return refs.filter((r) => (seen.has(r.label) ? false : (seen.add(r.label), true)));
}
function owaspUrl(owasp: string): string {
  const m = owasp.match(/A(\d{2})/);
  return m ? `https://owasp.org/Top10/A${m[1]}_2021/` : "https://owasp.org/www-project-top-ten/";
}
