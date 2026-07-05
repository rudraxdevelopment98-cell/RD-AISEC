// Auto-fill a bug-bounty program's scope from its link. Two paths:
//   1) HackerOne + a saved API token → exact in/out scope from the API.
//   2) Any other link → best-effort scrape of the public page (wildcards +
//      domains, split around an "out of scope" heading). Candidates to review.
// Server-only (network). No DB — the caller passes decrypted HackerOne creds.

import { fetchScopeSplit } from "@/lib/hackerone";

export type ProgramScope = {
  platform: string;
  handle: string;
  name?: string;
  inScope: string[];
  outScope: string[];
  source: "hackerone-api" | "page" | "none";
  note?: string;
};

export function parseProgramUrl(raw: string): {
  platform: string;
  handle: string;
  host: string;
} {
  let host = "";
  let handle = "";
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw.trim()}`);
    host = u.hostname.toLowerCase();
    const segs = u.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
    // Bugcrowd links are /engagements/{handle} or the legacy /{handle}.
    handle = segs[0] === "engagements" ? segs[1] ?? "" : segs[0] ?? "";
  } catch {
    return { platform: "other", handle: "", host: "" };
  }
  let platform = "other";
  if (host.includes("hackerone.com")) platform = "hackerone";
  else if (host.includes("bugcrowd.com")) platform = "bugcrowd";
  else if (host.includes("intigriti.com")) platform = "intigriti";
  else if (host.includes("yeswehack.com")) platform = "yeswehack";
  return { platform, handle, host };
}

/** Block loopback / private / link-local / metadata targets (SSRF guard). */
function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
  // Numeric IPs: only allow if clearly public.
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    )
      return false;
  }
  if (h.includes(":")) return false; // skip IPv6 literals (could be ::1/ULA)
  return true;
}

const NOISE = new Set([
  "hackerone.com", "bugcrowd.com", "intigriti.com", "yeswehack.com",
  "google.com", "gstatic.com", "googleapis.com", "cloudflare.com",
  "cloudfront.net", "gravatar.com", "w3.org", "schema.org", "github.com",
  "twitter.com", "facebook.com", "linkedin.com", "youtube.com", "sentry.io",
  "jsdelivr.net", "fontawesome.com", "example.com",
]);

const HOST_RE = /\*?\.?\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b/gi;

function harvestHosts(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.match(HOST_RE) ?? []) {
    let h = raw.trim().toLowerCase().replace(/^\.+/, "");
    const bare = h.replace(/^\*\./, "");
    if (bare.length < 4 || bare.length > 100) continue;
    // Drop obvious asset/file references and platform/CDN noise.
    if (/\.(png|jpg|jpeg|gif|svg|css|js|woff2?|ico|json|xml|webp)$/i.test(bare)) continue;
    if (NOISE.has(bare)) continue;
    out.add(h);
  }
  return [...out];
}

const UA = "Mozilla/5.0 (compatible; RD-AISEC/1.0; scope-import)";

async function bcJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA },
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`bugcrowd ${res.status}`);
  // Auth-gated routes return the SPA HTML shell instead of JSON.
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) throw new Error("bugcrowd: not json (gated)");
  return res.json();
}

/**
 * Bugcrowd scope, unauthenticated: the engagement's latest changelog entry is
 * public JSON and embeds the full brief. changelog.json → latest id →
 * changelog/{id}.json → data.scope[] (groups with inScope + targets[].name).
 */
async function scrapeBugcrowd(
  handle: string,
): Promise<{ inScope: string[]; outScope: string[]; name?: string }> {
  const base = `https://bugcrowd.com/engagements/${encodeURIComponent(handle)}`;
  const list = await bcJson(`${base}/changelog.json`);
  const logs = (list?.changelogs as { id?: string; changelogState?: string }[]) ?? [];
  const latest = logs.find((l) => l.changelogState === "Latest") ?? logs[0];
  if (!latest?.id) throw new Error("bugcrowd: no changelog");

  const detail = await bcJson(`${base}/changelog/${latest.id}.json`);
  const data = (detail?.data as Record<string, unknown>) ?? {};
  const groups =
    (data.scope as { inScope?: boolean; targets?: { name?: string; uri?: string; ipAddress?: string }[] }[]) ?? [];
  const name = ((data.brief as { name?: string })?.name ?? "").trim() || undefined;

  const inScope = new Set<string>();
  const outScope = new Set<string>();
  for (const g of groups) {
    for (const t of g.targets ?? []) {
      const id = String(t.name || t.uri || t.ipAddress || "").trim();
      if (!id) continue;
      (g.inScope === false ? outScope : inScope).add(id);
    }
  }
  if (inScope.size === 0 && outScope.size === 0) throw new Error("bugcrowd: no targets");
  return { inScope: [...inScope], outScope: [...outScope], name };
}

async function scrapePage(url: string): Promise<{ inScope: string[]; outScope: string[]; name?: string }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RD-AISEC/1.0; scope-import)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`page returned ${res.status}`);
  const html = await res.text();
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
  // Split around the first "out of scope" marker so we can separate the two.
  const text = html.replace(/<[^>]+>/g, " ");
  const cut = text.search(/out[\s-]*of[\s-]*scope/i);
  const inPart = cut > 0 ? text.slice(0, cut) : text;
  const outPart = cut > 0 ? text.slice(cut) : "";
  const inScope = harvestHosts(inPart).slice(0, 60);
  const outSet = new Set(harvestHosts(outPart).slice(0, 60));
  // A host can't be both — in-scope wins.
  const inSet = new Set(inScope);
  const outScope = [...outSet].filter((h) => !inSet.has(h));
  return { inScope, outScope, name: title };
}

export async function fetchProgramScope(
  url: string,
  creds?: { user: string; token: string },
): Promise<ProgramScope> {
  const { platform, handle } = parseProgramUrl(url);

  // 1) HackerOne via the API token — exact scope.
  if (platform === "hackerone" && handle && creds?.user && creds?.token) {
    try {
      const { inScope, outScope } = await fetchScopeSplit(creds.user, creds.token, handle);
      if (inScope.length || outScope.length) {
        return { platform, handle, inScope, outScope, source: "hackerone-api" };
      }
    } catch {
      /* fall through to the page scrape */
    }
  }

  // 2) Bugcrowd — the engagement's public changelog JSON carries the full scope.
  if (platform === "bugcrowd" && handle) {
    try {
      const { inScope, outScope, name } = await scrapeBugcrowd(handle);
      if (inScope.length || outScope.length) {
        return { platform, handle, name, inScope, outScope, source: "page" };
      }
    } catch {
      /* fall through to the generic scrape */
    }
  }

  // 3) Best-effort public page scrape (Intigriti / YesWeHack / anything else).
  const full = /^https?:\/\//i.test(url) ? url : `https://${url.trim()}`;
  if (!isPublicHttpUrl(full)) {
    return {
      platform,
      handle,
      inScope: [],
      outScope: [],
      source: "none",
      note: "That link can't be fetched. Paste the scope manually.",
    };
  }
  try {
    const { inScope, outScope, name } = await scrapePage(full);
    return {
      platform,
      handle,
      name,
      inScope,
      outScope,
      source: "page",
      note:
        inScope.length === 0
          ? platform === "hackerone"
            ? "Couldn't read scope from the page. Add your HackerOne API token on the Accounts tab for exact auto-fill."
            : "Couldn't detect scope on that page — paste it manually, or check the link."
          : "Scraped from the page — review the targets before scanning; wildcards/domains may be incomplete.",
    };
  } catch {
    return {
      platform,
      handle,
      inScope: [],
      outScope: [],
      source: "none",
      note: "Couldn't fetch that link. Paste the scope manually, or add a HackerOne API token for exact auto-sync.",
    };
  }
}
