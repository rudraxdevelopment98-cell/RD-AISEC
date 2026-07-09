import "server-only";
import { prisma } from "@/lib/db";

/**
 * Read the synced CISA KEV catalog (CVEs actively exploited in the wild). Cached
 * per server instance for a few minutes so the report/findings pages don't hit
 * the DB per finding. Returns an empty set until a runner has synced the feed.
 */
let cache: { set: Set<string>; at: number } | null = null;
const TTL_MS = 5 * 60_000;

export async function getKevSet(): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.set;
  try {
    const row = await prisma.threatFeed.findUnique({ where: { kind: "kev" } });
    const ids: string[] = String(row?.data ?? "")
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    const set = new Set<string>(ids);
    cache = { set, at: Date.now() };
    return set;
  } catch {
    return cache?.set ?? new Set();
  }
}

/**
 * Read the synced EPSS scores (CVE → 0..1 predicted-exploitation probability).
 * Stored as comma-joined "CVE:score" pairs. Cached per instance. Empty until a
 * runner (v52.1+) has synced the feed.
 */
let epssCache: { map: Map<string, number>; at: number } | null = null;

export async function getEpssMap(): Promise<Map<string, number>> {
  if (epssCache && Date.now() - epssCache.at < TTL_MS) return epssCache.map;
  try {
    const row = await prisma.threatFeed.findUnique({ where: { kind: "epss" } });
    const map = new Map<string, number>();
    for (const pair of String(row?.data ?? "").split(",")) {
      const [cve, score] = pair.split(":");
      const n = Number(score);
      if (cve && Number.isFinite(n)) map.set(cve.trim().toUpperCase(), n);
    }
    epssCache = { map, at: Date.now() };
    return map;
  } catch {
    return epssCache?.map ?? new Map();
  }
}

/** First CVE id in a text blob, upper-cased (or null). */
export function firstCve(text: string): string | null {
  return text.match(/\bCVE-\d{4}-\d{3,7}\b/i)?.[0]?.toUpperCase() ?? null;
}

/** True if the finding's CVE is in the KEV catalog (actively exploited). */
export function isKnownExploited(text: string, kev: Set<string>): boolean {
  if (kev.size === 0) return false;
  const cve = firstCve(text);
  return !!cve && kev.has(cve);
}
