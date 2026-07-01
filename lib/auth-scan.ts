// Authenticated / session-aware scanning.
//
// Many high-value bug classes — IDOR, broken access control, business-logic
// flaws, authenticated stored XSS — are ONLY reachable behind a login. This
// module lets an engagement carry a single HTTP auth header (a session cookie or
// a bearer token) that the runner injects into header-capable tools so their
// requests are made *as the logged-in user*.
//
// Pure by design: no prisma / server imports, so it is client-safe AND unit
// testable. The engagement's header is stored ENCRYPTED at rest (see
// lib/crypto) and only decrypted server-side at job-serve time; the plaintext is
// never persisted in a Job row and never logged.
//
// For authorized security testing and education only — use a session you own or
// are explicitly authorized to test with.

/** Tools that accept an HTTP request header, and how the header is passed. */
const HEADER_TOOLS: Record<string, "H" | "wpscan-cookie"> = {
  nuclei: "H",
  httpx: "H",
  katana: "H",
  ffuf: "H",
  feroxbuster: "H",
  gobuster: "H",
  dalfox: "H",
  sqlmap: "H",
  // wpscan only takes cookies, and wants the bare "name=value" (no "Cookie:").
  wpscan: "wpscan-cookie",
};

/** Does this tool support an injected auth header at all? */
export function supportsAuthHeader(tool: string): boolean {
  return tool in HEADER_TOOLS;
}

/** Tools we can carry a session into — for UI hints. */
export const AUTH_HEADER_TOOLS = Object.keys(HEADER_TOOLS);

/**
 * Validate a raw HTTP header line, e.g. `Cookie: session=abc; csrf=xyz` or
 * `Authorization: Bearer eyJ...`. Must be a single line of printable ASCII, look
 * like `Name: value` (contain a colon), not begin with `-` (so it can never be
 * mistaken for a flag), and stay within a sane length. Header VALUES routinely
 * contain spaces and `=` / `;` / `.` / `/` — which is exactly why the header can
 * never ride in the runner's space-split `args` string and must be injected as a
 * single argv element instead.
 */
export function isSafeHeader(s: string): boolean {
  if (!s) return false;
  const t = s.trim();
  return (
    t.length > 0 &&
    t.length <= 1024 &&
    /^[\x20-\x7e]+$/.test(t) && // printable ASCII, single line (no CR/LF/control)
    t.includes(":") &&
    !t.startsWith("-")
  );
}

/**
 * The extra argv tokens that inject `header` into `tool`'s request, or `[]` if
 * the tool doesn't support headers or the header is unsafe. The header VALUE is
 * returned as its own single element (never split), so the runner appends it
 * verbatim as one argument — no shell, no re-splitting, no injection surface.
 */
export function authArgvForTool(tool: string, header: string): string[] {
  if (!isSafeHeader(header)) return [];
  const kind = HEADER_TOOLS[tool];
  if (!kind) return [];
  const value = header.trim();
  if (kind === "H") return ["-H", value];
  if (kind === "wpscan-cookie") {
    // Extract the cookie pair(s) after "Cookie:"; wpscan rejects a full header.
    const m = value.match(/^cookie:\s*(.+)$/i);
    if (!m) return [];
    const pairs = m[1].trim();
    return pairs ? ["--cookie-string", pairs] : [];
  }
  return [];
}

/**
 * Short human label for a stored header (for the UI), e.g. "Cookie" or
 * "Authorization (Bearer)". Never reveals the secret value.
 */
export function describeHeader(header: string): string {
  const name = header.split(":")[0]?.trim() || "header";
  if (/^authorization$/i.test(name) && /bearer\s/i.test(header)) {
    return "Authorization (Bearer token)";
  }
  return name.replace(/^\w/, (c) => c.toUpperCase());
}
