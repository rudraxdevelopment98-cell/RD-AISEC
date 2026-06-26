// Minimal HackerOne hacker-API client. Auth = HTTP Basic (API username : API
// token). Free to create a token at hackerone.com → Settings → API Token.
// Node-only (uses fetch on the server).

const BASE = "https://api.hackerone.com/v1";

function authHeader(user: string, token: string): string {
  return "Basic " + Buffer.from(`${user}:${token}`).toString("base64");
}

export type H1Program = { handle: string; name: string };

async function h1(path: string, user: string, token: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: authHeader(user, token), Accept: "application/json" },
    // Don't cache credentialed responses.
    cache: "no-store",
  });
  if (res.status === 401) throw new Error("HackerOne rejected the credentials (check username/token).");
  if (res.status === 429) throw new Error("HackerOne rate limit hit — try again later.");
  if (!res.ok) throw new Error(`HackerOne API error ${res.status}.`);
  return res.json();
}

/** Programs the account can access (first page; up to `cap`). */
export async function fetchPrograms(
  user: string,
  token: string,
  cap = 50,
): Promise<H1Program[]> {
  const json = await h1(`/hackers/programs?page[size]=100`, user, token);
  const data: unknown[] = Array.isArray(json?.data) ? json.data : [];
  return data
    .map((d) => {
      const a = (d as { attributes?: { handle?: string; name?: string } }).attributes ?? {};
      return { handle: a.handle ?? "", name: a.name ?? a.handle ?? "" };
    })
    .filter((p) => p.handle)
    .slice(0, cap);
}

/**
 * In-scope, submittable asset identifiers for a program. Returns URL/domain/IP
 * style assets that make sense to scan (skips source-code, app-store, etc.).
 */
export async function fetchScope(
  user: string,
  token: string,
  handle: string,
): Promise<string[]> {
  const json = await h1(
    `/hackers/programs/${encodeURIComponent(handle)}/structured_scopes?page[size]=100`,
    user,
    token,
  );
  const data: unknown[] = Array.isArray(json?.data) ? json.data : [];
  const SCANNABLE = new Set([
    "URL",
    "WILDCARD",
    "IP_ADDRESS",
    "CIDR",
    "DOMAIN",
    "OTHER",
  ]);
  return data
    .map((d) => (d as { attributes?: Record<string, unknown> }).attributes ?? {})
    .filter((a) => a.eligible_for_submission !== false)
    .filter((a) => SCANNABLE.has(String(a.asset_type ?? "URL")))
    .map((a) => String(a.asset_identifier ?? "").trim())
    .filter(Boolean);
}
