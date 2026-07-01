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
    const set = new Set(
      (row?.data ?? "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean),
    );
    cache = { set, at: Date.now() };
    return set;
  } catch {
    return cache?.set ?? new Set();
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
