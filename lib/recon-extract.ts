// Iterative-recon extraction core (pure, no IO — unit-tested).
//
// The engine's recon was one-shot: run a tool, parse findings, stop. Real bug
// hunting is a loop — crawl, mine JavaScript for endpoints/parameters, then feed
// the NEW surface back into targeted scans. This module is the mining step: given
// crawl / JS / wayback output, it extracts a deduped, normalized inventory of
// endpoints and parameters that the pipeline re-scans and the IDOR engine tests.
//
// Precision over recall: static assets are dropped, relative paths are resolved
// against the crawl host, and only real request URLs survive — so the feedback
// loop doesn't drown the runner in junk.

// Absolute URLs anywhere in the text.
const ABS_URL = /https?:\/\/[^\s"'`<>()\[\]]+/gi;
// Quoted root-relative paths in JS/HTML, e.g. fetch("/api/orders/1"), "/v1/users".
const REL_PATH = /["'`](\/[a-zA-Z0-9_\-./]{1,200}(?:\?[^"'`\s]{0,200})?)["'`]/g;
// Static assets we never treat as endpoints (they're not request surface).
const ASSET = /\.(?:css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|map|mp4|webm|mp3|pdf|zip|gz|avif)(?:$|\?)/i;

function stripFragment(u: string): string {
  return u.split("#")[0];
}

/** All absolute request URLs in the text (assets dropped, fragments stripped). */
export function extractUrls(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.match(ABS_URL) ?? []) {
    const u = stripFragment(m.replace(/[.,;)]+$/, "")); // trim trailing punctuation
    if (!ASSET.test(u)) out.add(u);
  }
  return [...out];
}

/** Root-relative paths mined from JS/HTML (the endpoints a crawler's link
 *  extraction misses because they're built at runtime). */
export function extractPaths(text: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(REL_PATH.source, "g");
  while ((m = re.exec(text)) !== null) {
    const p = stripFragment(m[1]);
    // Skip protocol-relative (//cdn…), asset files, and bare "/".
    if (p.length < 2 || p.startsWith("//") || ASSET.test(p)) continue;
    out.add(p);
  }
  return [...out];
}

function hostBase(url: string): string | null {
  const m = url.match(/^(https?:\/\/[^/]+)/i);
  return m ? m[1] : null;
}

/**
 * Full endpoint inventory from crawl/JS output. Absolute URLs are kept as-is;
 * relative paths are resolved against the discovered host(s) (or `baseUrl` when no
 * absolute URL is present). Deduped, asset-free, capped.
 */
export function extractEndpoints(text: string, baseUrl?: string, cap = 500): string[] {
  const urls = extractUrls(text);
  const bases = new Set<string>();
  for (const u of urls) {
    const b = hostBase(u);
    if (b) bases.add(b);
  }
  if (baseUrl) {
    const b = hostBase(baseUrl) ?? (baseUrl.startsWith("http") ? baseUrl : `http://${baseUrl}`.replace(/\/+$/, ""));
    if (b) bases.add(b);
  }
  const out = new Set<string>(urls);
  const baseList = [...bases];
  for (const p of extractPaths(text)) {
    if (baseList.length === 0) continue;
    // Resolve a relative path against every discovered host (usually one).
    for (const b of baseList.slice(0, 3)) out.add(b + p);
  }
  return [...out].slice(0, cap);
}

/** URLs that carry at least one query parameter — the injection/fuzzing surface
 *  (XSS, SQLi, SSRF, open-redirect all live on parameters). */
export function parameterizedUrls(urls: string[]): string[] {
  return urls.filter((u) => /\?[^#]*=/.test(u));
}

/** JavaScript bundles among the URLs — the richest source of leaked secrets and
 *  hidden endpoints, worth fetching + scanning for credentials. */
export function jsUrls(urls: string[]): string[] {
  return urls.filter((u) => /\.m?js(?:$|\?)/i.test(u));
}

/** Distinct query-parameter names across the given URLs (for param-level testing). */
export function extractParams(urls: string[]): string[] {
  const out = new Set<string>();
  for (const u of urls) {
    const q = u.split("?")[1];
    if (!q) continue;
    for (const pair of q.split("&")) {
      const name = pair.split("=")[0]?.trim();
      if (name && /^[a-zA-Z0-9_\-\[\]]{1,64}$/.test(name)) out.add(name);
    }
  }
  return [...out];
}
