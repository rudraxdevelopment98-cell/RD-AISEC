/**
 * Format a finding into a HackerOne-ready report.
 *
 * We submit through HackerOne's Report INTENT API (a draft), so the create call
 * only needs `team_handle`, `title`, and `description` — the final severity /
 * weakness (CWE) classification is set by the human at approval time on H1. This
 * module is the pure, testable formatter: finding → { title, description,
 * severityRating }. No network, no secrets.
 */

export type FindingLike = {
  title: string;
  severity: string;
  description?: string;
  recommendation?: string;
  category?: string;
  owasp?: string;
  attack?: string;
  confirmed?: boolean;
  sources?: string;
};

export type H1SeverityRating = "none" | "low" | "medium" | "high" | "critical";

export type H1Report = {
  title: string;
  /** Markdown body — H1 report-intent `description` / direct-report `vulnerability_information`. */
  description: string;
  severityRating: H1SeverityRating;
};

/** Map our internal severity to HackerOne's severity_rating vocabulary. */
export function h1Severity(sev: string): H1SeverityRating {
  switch ((sev || "").toLowerCase()) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
      return "low";
    default:
      return "none"; // "info" and anything unknown
  }
}

// Reference-only CWE hints by keyword (shown in the report's References; NOT the
// H1 weakness_id, which the human picks at approval). Kept small + high-signal.
const CWE_HINTS: { re: RegExp; cwe: string; name: string }[] = [
  { re: /sql\s*inj|sqli/i, cwe: "CWE-89", name: "SQL Injection" },
  { re: /\bxss\b|cross.?site scripting/i, cwe: "CWE-79", name: "Cross-site Scripting" },
  { re: /\bssrf\b|server.?side request/i, cwe: "CWE-918", name: "Server-Side Request Forgery" },
  { re: /\bidor\b|bola|broken object|access control/i, cwe: "CWE-639", name: "Authorization Bypass (IDOR)" },
  { re: /\brce\b|remote code|command inj/i, cwe: "CWE-77", name: "Command Injection / RCE" },
  { re: /\bssti\b|template inj/i, cwe: "CWE-1336", name: "Server-Side Template Injection" },
  { re: /path travers|lfi|directory travers/i, cwe: "CWE-22", name: "Path Traversal" },
  { re: /\bxxe\b|xml external/i, cwe: "CWE-611", name: "XXE" },
  { re: /open redirect/i, cwe: "CWE-601", name: "Open Redirect" },
  { re: /\bcsrf\b|cross.?site request forgery/i, cwe: "CWE-352", name: "CSRF" },
  { re: /secret|api key|token|credential leak|exposed key/i, cwe: "CWE-798", name: "Hard-coded / Exposed Credentials" },
  { re: /deserial/i, cwe: "CWE-502", name: "Insecure Deserialization" },
  { re: /auth(entication)? bypass|weak auth|default cred/i, cwe: "CWE-287", name: "Improper Authentication" },
];

function cweHint(f: FindingLike): { cwe: string; name: string } | null {
  const hay = `${f.title} ${f.category ?? ""} ${f.description ?? ""}`;
  for (const h of CWE_HINTS) if (h.re.test(hay)) return { cwe: h.cwe, name: h.name };
  return null;
}

function section(heading: string, body: string): string {
  const b = (body || "").trim();
  return b ? `## ${heading}\n\n${b}\n` : "";
}

/**
 * Build the HackerOne report from a finding. `asset` is the in-scope target the
 * finding is about (host/URL); it anchors the "Affected asset" section.
 */
export function buildHackerOneReport(f: FindingLike, opts: { asset?: string } = {}): H1Report {
  const title = (f.title || "Security finding").trim().slice(0, 255);
  const rating = h1Severity(f.severity);
  const cwe = cweHint(f);

  const summary = (f.description || "").trim() || "A security issue was identified during authorized testing.";
  const remediation =
    (f.recommendation || "").trim() ||
    "Apply the vendor-recommended fix for this issue class, validate input/output at trust boundaries, and re-test to confirm the fix.";

  // Steps to reproduce: if the description already reads like steps, reuse it;
  // otherwise give a clear, honest placeholder the human fills at review.
  const looksLikeSteps = /\b(step|1\.|1\)|curl |http[s]?:\/\/)/i.test(f.description || "");
  const steps = looksLikeSteps
    ? (f.description || "").trim()
    : [
        "1. Navigate to the affected asset below.",
        "2. Perform the request/interaction described in the summary.",
        "3. Observe the response demonstrating the issue (see Proof of concept).",
      ].join("\n");

  const impact =
    rating === "critical" || rating === "high"
      ? "An attacker could exploit this to compromise confidentiality, integrity, or availability of the affected asset and its users' data. See severity."
      : "This weakens the security posture of the affected asset and can aid a broader attack. See severity.";

  const refs: string[] = [];
  if (cwe) refs.push(`- ${cwe.cwe}: ${cwe.name}`);
  if (f.owasp) refs.push(`- OWASP Top 10: ${f.owasp}`);
  if (f.attack) refs.push(`- MITRE ATT&CK: ${f.attack}`);
  if (f.sources) refs.push(`- Detected by: ${f.sources}`);

  const body = [
    section("Summary", summary),
    section("Affected asset", opts.asset ? `\`${opts.asset}\`` : "_(the in-scope target this finding concerns)_"),
    section("Steps to reproduce", steps),
    section(
      "Proof of concept",
      f.confirmed
        ? "This issue was validated during testing. Reproduction output / evidence is attached."
        : "Reproduction output / evidence is attached. Reproduce with the steps above.",
    ),
    section("Impact", impact),
    section("Severity", `${rating.toUpperCase()} (mapped from the engine's ${f.severity || "unrated"} rating; confirm/adjust the CVSS at triage).`),
    section("Remediation", remediation),
    section("References", refs.join("\n")),
    "---\n\n_Reported via authorized security testing. Please treat under your disclosure policy._",
  ]
    .filter(Boolean)
    .join("\n");

  return { title, description: body, severityRating: rating };
}
