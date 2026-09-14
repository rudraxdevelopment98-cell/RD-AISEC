/**
 * Novelty / dedupe gate (P2).
 *
 * In 2026, duplicate reports are auto-closed (HackerOne Hai Triage) and burn your
 * reputation, so a finding must be PROVEN (P1) *and* NOVEL before it's worth
 * submitting. This is the pure core:
 *   - a normalized signature + SimHash so near-identical findings collapse
 *     (XBOW uses SimHash for exactly this),
 *   - Hamming-distance duplicate detection against our own prior findings,
 *   - a heuristic novelty score (common automated classes are low-value / likely
 *     already reported; differential/OOB-proven classes are high-value).
 * See docs/ENGINE-EARNING-RESEARCH.md.
 */

export type NoveltyInput = {
  title?: string;
  category?: string;
  description?: string;
  /** The affected asset (host or URL) if known — sharpens the signature. */
  asset?: string;
};

// ── Signature ────────────────────────────────────────────────────────────────
// A stable, comparable string for a finding: host + vuln-class + path-shape +
// param names, with volatile ids/tokens removed so "?id=1" and "?id=99" collapse.
export function findingSignature(f: NoveltyInput): string {
  const cls = classOf(f);
  const host = hostOf(f.asset ?? extractUrl(`${f.title ?? ""} ${f.description ?? ""}`));
  const pathShape = pathShapeOf(f.asset ?? extractUrl(`${f.title ?? ""} ${f.description ?? ""}`));
  return [host, cls, pathShape].filter(Boolean).join(" ").toLowerCase().trim() || normalizeTitle(f.title ?? "");
}

function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CLASS_RE: [RegExp, string][] = [
  [/\bssti\b|template inj/i, "ssti"],
  [/\bssrf\b/i, "ssrf"],
  [/\bxxe\b/i, "xxe"],
  [/\brce\b|command inj|remote code/i, "rce"],
  [/sql\s*inj|sqli\b/i, "sqli"],
  [/\bidor\b|bola|broken object|access control/i, "idor"],
  [/open redirect/i, "redirect"],
  [/\bxss\b|cross.?site scripting/i, "xss"],
  [/secret|api key|token|credential/i, "secret"],
  [/security header|missing header/i, "headers"],
  [/\bcors\b/i, "cors"],
];
function classOf(f: NoveltyInput): string {
  const hay = `${f.title ?? ""} ${f.category ?? ""} ${f.description ?? ""}`;
  for (const [re, c] of CLASS_RE) if (re.test(hay)) return c;
  return (f.category ?? "misc").toLowerCase().slice(0, 16) || "misc";
}

function extractUrl(text: string): string {
  const m = (text || "").match(/https?:\/\/[^\s"'<>)]+/i);
  return m ? m[0] : "";
}
function hostOf(url: string): string {
  if (!url) return "";
  try {
    return new URL(url.includes("://") ? url : `http://${url}`).hostname.toLowerCase();
  } catch {
    return url.split("/")[0].toLowerCase();
  }
}
// Path with numeric / hex / uuid segments replaced by {id}, query reduced to sorted keys.
function pathShapeOf(url: string): string {
  if (!url) return "";
  let u: URL;
  try {
    u = new URL(url.includes("://") ? url : `http://${url}`);
  } catch {
    return "";
  }
  const path = u.pathname
    .split("/")
    .map((seg) => (/^([0-9]+|[0-9a-f]{8,}|[0-9a-f-]{16,})$/i.test(seg) ? "{id}" : seg))
    .join("/");
  const keys = [...u.searchParams.keys()].map((k) => k.toLowerCase()).sort();
  return keys.length ? `${path}?${keys.join(",")}` : path;
}

// ── SimHash (32-bit, plain ints — no BigInt) over the signature's tokens ─────
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
export function simhash(text: string): number {
  const toks = text.split(/\s+/).filter(Boolean);
  if (toks.length === 0) return 0;
  const v = new Array(32).fill(0);
  for (const tok of toks) {
    const h = fnv1a32(tok);
    for (let i = 0; i < 32; i++) v[i] += (h >>> i) & 1 ? 1 : -1;
  }
  let out = 0;
  for (let i = 0; i < 32; i++) if (v[i] > 0) out |= 1 << i;
  return out >>> 0;
}
export function hamming(a: number, b: number): number {
  let x = (a ^ b) >>> 0;
  let c = 0;
  while (x) {
    c += x & 1;
    x >>>= 1;
  }
  return c;
}

/** Duplicate if the finding's simhash is within `maxDistance` bits of any prior. */
export function isDuplicate(sig: number, priors: number[], maxDistance = 3): boolean {
  return priors.some((p) => hamming(sig, p) <= maxDistance);
}

// ── Novelty score ────────────────────────────────────────────────────────────
// How likely this is genuinely worth reporting (not already reported by 100 other
// hunters' automation). High = differential/OOB classes that need real proof;
// low = commodity scanner output.
const CLASS_NOVELTY: Record<string, number> = {
  idor: 90, ssrf: 85, rce: 92, ssti: 85, sqli: 80, secret: 78, xxe: 82,
  xss: 55, redirect: 40, cors: 45, headers: 12, misc: 40,
};

export type NoveltyVerdict = { novelty: number; duplicate: boolean; reason: string };

export function assessNovelty(
  f: NoveltyInput & { confirmed?: boolean },
  priorHashes: number[] = [],
): NoveltyVerdict {
  const sig = findingSignature(f);
  const h = simhash(sig);
  const duplicate = isDuplicate(h, priorHashes);
  const cls = classOf(f);
  let novelty = CLASS_NOVELTY[cls] ?? 40;
  if (f.confirmed) novelty = Math.min(100, novelty + 10); // proven → more worth reporting
  if (duplicate) novelty = Math.round(novelty * 0.15);
  const reason = duplicate
    ? "near-duplicate of an existing finding — do not resubmit"
    : cls === "headers" || novelty < 30
      ? "commodity/low-value class — likely already reported or informative"
      : "looks novel enough to be worth a proven report";
  return { novelty, duplicate, reason };
}
