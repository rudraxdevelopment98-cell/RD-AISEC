// Supplemental detection — broadens the engine's classification so fewer findings
// land "unclassified". The strict vuln taxonomy (lib/vuln-taxonomy) is precise but
// narrow; real tool output phrases things many ways. When the taxonomy doesn't
// match, this second pass recognises common scanner findings (headers, cookies,
// TLS, exposure, email auth, etc.) and still attaches an OWASP/CWE/surface so the
// finding gets a risk score and a remediation category. Pure, unit-tested.

export type Surface = "web" | "api" | "network" | "host" | "cloud" | "auth" | "crypto" | "info";

export type SuppMatch = {
  classId: string;
  label: string;
  owasp: string;
  cwe: string;
  surface: Surface;
};

type Sig = SuppMatch & { re: RegExp };

// Ordered most-specific → general. First match wins.
const SIGS: Sig[] = [
  { re: /clickjack|x-frame-options|frame-ancestors/i, classId: "clickjacking", label: "Clickjacking / framing", owasp: "A05:2021 Misconfiguration", cwe: "CWE-1021", surface: "web" },
  { re: /cookie.*(without|missing).*(secure|httponly|samesite)|(secure|httponly|samesite).*flag.*(not set|missing)/i, classId: "cookie_flags", label: "Insecure cookie flags", owasp: "A05:2021 Misconfiguration", cwe: "CWE-614", surface: "web" },
  { re: /directory listing|index of \/|autoindex/i, classId: "dir_listing", label: "Directory listing enabled", owasp: "A05:2021 Misconfiguration", cwe: "CWE-548", surface: "web" },
  { re: /anonymous ftp|ftp anonymous|anonymous login allowed/i, classId: "anon_ftp", label: "Anonymous FTP access", owasp: "A05:2021 Misconfiguration", cwe: "CWE-284", surface: "network" },
  { re: /expired certificate|certificate has expired|self-signed cert|untrusted (certificate|ca)|hostname mismatch/i, classId: "cert_issue", label: "Certificate validity issue", owasp: "A02:2021 Cryptographic Failures", cwe: "CWE-295", surface: "crypto" },
  { re: /weak cipher|rc4|3des|export cipher|null cipher|sslv[23]|tls 1\.0|tls 1\.1|poodle|beast|sweet32|logjam|freak/i, classId: "weak_tls", label: "Weak TLS/SSL configuration", owasp: "A02:2021 Cryptographic Failures", cwe: "CWE-326", surface: "crypto" },
  { re: /missing (spf|dkim|dmarc)|no (spf|dmarc) record|spoofing possible/i, classId: "email_auth", label: "Missing email authentication (SPF/DKIM/DMARC)", owasp: "A05:2021 Misconfiguration", cwe: "CWE-1021", surface: "info" },
  { re: /login.*over http\b|password.*(sent|submitted).*(cleartext|http)|form posts to http|mixed content/i, classId: "cleartext_transport", label: "Sensitive data over cleartext", owasp: "A02:2021 Cryptographic Failures", cwe: "CWE-319", surface: "crypto" },
  { re: /missing (security )?header|content-security-policy|strict-transport|x-content-type-options|referrer-policy|permissions-policy/i, classId: "missing_headers", label: "Missing security headers", owasp: "A05:2021 Misconfiguration", cwe: "CWE-693", surface: "web" },
  { re: /server (banner|version|token)|version disclosure|x-powered-by|software version (exposed|disclosed)/i, classId: "version_disclosure", label: "Software/version disclosure", owasp: "A05:2021 Misconfiguration", cwe: "CWE-200", surface: "info" },
  { re: /\.git\/|\.env\b|backup file|\.bak\b|\.old\b|exposed (config|backup|source)|swagger|api docs exposed/i, classId: "sensitive_file", label: "Sensitive file/endpoint exposed", owasp: "A05:2021 Misconfiguration", cwe: "CWE-538", surface: "web" },
  { re: /stack trace|debug (mode|enabled)|verbose error|exception (details|leaked)|php notice|traceback/i, classId: "debug_exposure", label: "Debug/verbose error exposure", owasp: "A05:2021 Misconfiguration", cwe: "CWE-209", surface: "web" },
  { re: /open (port|service)|unnecessary service|telnet|rlogin|rsh\b|finger service|snmp public|community string/i, classId: "exposed_service", label: "Exposed/unnecessary service", owasp: "A05:2021 Misconfiguration", cwe: "CWE-284", surface: "network" },
  { re: /rate limit|brute.?force|no account lockout|password policy|weak password/i, classId: "weak_authn_controls", label: "Weak authentication controls", owasp: "A07:2021 Auth Failures", cwe: "CWE-307", surface: "auth" },
  { re: /s3 bucket|blob container|storage (bucket|account).*(public|open)|publicly (readable|writable)/i, classId: "open_storage", label: "Publicly exposed cloud storage", owasp: "A05:2021 Misconfiguration", cwe: "CWE-732", surface: "cloud" },
  { re: /host header injection|host header/i, classId: "host_header", label: "Host header injection", owasp: "A03:2021 Injection", cwe: "CWE-644", surface: "web" },
  { re: /http (method|verb).*(enabled|allowed)|trace method|put method enabled|webdav/i, classId: "dangerous_methods", label: "Dangerous HTTP methods enabled", owasp: "A05:2021 Misconfiguration", cwe: "CWE-650", surface: "web" },
];

/** Second-pass classification for text the strict taxonomy didn't match. */
export function supplementalDetect(text: string): SuppMatch | null {
  const t = text || "";
  for (const s of SIGS) {
    if (s.re.test(t)) {
      const { re: _re, ...m } = s;
      return m;
    }
  }
  return null;
}

/** How many supplemental classes exist (for tests/telemetry). */
export const SUPPLEMENTAL_COUNT = SIGS.length;
