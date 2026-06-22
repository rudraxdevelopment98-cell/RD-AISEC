import "server-only";

/**
 * Web Security Posture Scanner.
 *
 * Performs a SINGLE, passive GET against an authorized target and analyzes the
 * response (security headers, cookie flags, HTTPS/redirect, version disclosure).
 * It does not attack, fuzz, or send multiple/abusive requests — it's a hardening
 * checker. Each failed check maps to a finding with a severity + recommendation.
 */

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type Check = {
  id: string;
  name: string;
  severity: Severity;
  passed: boolean;
  detail: string;
  recommendation: string;
};

export type ScanResult = {
  target: string;
  finalUrl: string | null;
  statusCode: number | null;
  error?: string;
  checks: Check[];
  score: { passed: number; total: number };
};

function normalizeUrl(input: string): string {
  const t = input.trim();
  if (!/^https?:\/\//i.test(t)) return `https://${t}`;
  return t;
}

function getSetCookies(headers: Headers): string[] {
  // Node/undici exposes getSetCookie(); fall back to a single header.
  const anyHeaders = headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") return anyHeaders.getSetCookie();
  const raw = headers.get("set-cookie");
  return raw ? [raw] : [];
}

/** Max targets accepted in one bulk scan. */
export const MAX_BULK_TARGETS = 10;

/** Parse a newline/comma/space-separated list of targets, de-duplicated. */
export function parseTargets(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\n,\s]+/)
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ).slice(0, MAX_BULK_TARGETS);
}

/** Scan many targets concurrently. */
export async function runScans(targets: string[]): Promise<ScanResult[]> {
  return Promise.all(targets.map((t) => runScan(t)));
}

export async function runScan(input: string): Promise<ScanResult> {
  const target = normalizeUrl(input);
  const base: ScanResult = {
    target,
    finalUrl: null,
    statusCode: null,
    checks: [],
    score: { passed: 0, total: 0 },
  };

  // Validate URL shape early.
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { ...base, error: "That doesn't look like a valid URL." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "RD-AISEC-Scanner/1.0 (+authorized security check)" },
      cache: "no-store",
    });
  } catch (e) {
    clearTimeout(timeout);
    const msg = e instanceof Error && e.name === "AbortError" ? "Request timed out." : "Could not reach the target.";
    return { ...base, error: msg };
  }
  clearTimeout(timeout);

  const h = res.headers;
  const finalUrl = res.url || target;
  const checks: Check[] = [];

  const add = (
    id: string,
    name: string,
    severity: Severity,
    passed: boolean,
    detail: string,
    recommendation: string,
  ) => checks.push({ id, name, severity, passed, detail, recommendation });

  // 1. HTTPS
  add(
    "https",
    "Served over HTTPS",
    "high",
    finalUrl.startsWith("https://"),
    finalUrl.startsWith("https://") ? `Final URL uses HTTPS.` : `Final URL is not HTTPS: ${finalUrl}`,
    "Serve all traffic over HTTPS and redirect HTTP to HTTPS.",
  );

  // 2. HSTS
  add(
    "hsts",
    "HTTP Strict-Transport-Security",
    "medium",
    h.has("strict-transport-security"),
    h.get("strict-transport-security") ?? "Header missing.",
    "Add `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.",
  );

  // 3. CSP
  add(
    "csp",
    "Content-Security-Policy",
    "high",
    h.has("content-security-policy"),
    h.get("content-security-policy") ? "Present." : "Header missing.",
    "Define a Content-Security-Policy to mitigate XSS and data injection.",
  );

  // 4. Clickjacking protection
  const csp = h.get("content-security-policy") ?? "";
  const clickjackOk = h.has("x-frame-options") || /frame-ancestors/i.test(csp);
  add(
    "clickjacking",
    "Clickjacking protection",
    "medium",
    clickjackOk,
    clickjackOk ? "X-Frame-Options or CSP frame-ancestors present." : "No X-Frame-Options or frame-ancestors.",
    "Set `X-Frame-Options: DENY` or a CSP `frame-ancestors` directive.",
  );

  // 5. X-Content-Type-Options
  add(
    "nosniff",
    "X-Content-Type-Options: nosniff",
    "low",
    (h.get("x-content-type-options") ?? "").toLowerCase() === "nosniff",
    h.get("x-content-type-options") ?? "Header missing.",
    "Add `X-Content-Type-Options: nosniff` to stop MIME sniffing.",
  );

  // 6. Referrer-Policy
  add(
    "referrer",
    "Referrer-Policy",
    "low",
    h.has("referrer-policy"),
    h.get("referrer-policy") ?? "Header missing.",
    "Add a `Referrer-Policy` such as `strict-origin-when-cross-origin`.",
  );

  // 7. Permissions-Policy
  add(
    "permissions",
    "Permissions-Policy",
    "info",
    h.has("permissions-policy"),
    h.get("permissions-policy") ?? "Header missing.",
    "Add a `Permissions-Policy` to restrict powerful browser features.",
  );

  // 8. Version / tech disclosure
  const server = h.get("server");
  const powered = h.get("x-powered-by");
  const discloses = !!(powered || (server && /\d/.test(server)));
  add(
    "disclosure",
    "No version/tech disclosure",
    "low",
    !discloses,
    discloses
      ? `Discloses: ${[server && `Server: ${server}`, powered && `X-Powered-By: ${powered}`].filter(Boolean).join(" · ")}`
      : "No obvious server/framework version disclosure.",
    "Suppress or genericize `Server` and remove `X-Powered-By` headers.",
  );

  // 9. Cookie flags
  const cookies = getSetCookies(h);
  if (cookies.length > 0) {
    const weak = cookies.filter(
      (c) =>
        !/;\s*secure/i.test(c) ||
        !/;\s*httponly/i.test(c) ||
        !/;\s*samesite/i.test(c),
    );
    add(
      "cookies",
      "Secure cookie flags",
      "medium",
      weak.length === 0,
      weak.length === 0
        ? `All ${cookies.length} cookie(s) set Secure, HttpOnly, and SameSite.`
        : `${weak.length} of ${cookies.length} cookie(s) missing Secure/HttpOnly/SameSite.`,
      "Set `Secure; HttpOnly; SameSite` on session cookies.",
    );
  } else {
    add(
      "cookies",
      "Secure cookie flags",
      "info",
      true,
      "No cookies were set on this response.",
      "N/A — no cookies observed.",
    );
  }

  const passed = checks.filter((c) => c.passed).length;
  return {
    target,
    finalUrl,
    statusCode: res.status,
    checks,
    score: { passed, total: checks.length },
  };
}
