// Core logic for recurring posture scans — shared by the Vercel cron route and
// the "Run now" server action. NOT a "use server" module (it exports
// non-action helpers), so the cron route can import it directly.

import { prisma } from "@/lib/db";
import { runScans } from "@/lib/scanner";
import { classifyFinding } from "@/lib/finding-map";

export const SCAN_FREQUENCIES = ["daily", "weekly"] as const;
export type ScanFrequency = (typeof SCAN_FREQUENCIES)[number];

const DAY = 24 * 60 * 60 * 1000;

export function intervalMs(frequency: string): number {
  return frequency === "weekly" ? 7 * DAY : DAY;
}

export function isDue(
  s: { frequency: string; lastRunAt: Date | null },
  now: number,
): boolean {
  if (!s.lastRunAt) return true;
  return now - new Date(s.lastRunAt).getTime() >= intervalMs(s.frequency);
}

type Schedule = {
  id: string;
  targets: string;
  engagementId: string;
  frequency: string;
  lastRunAt: Date | null;
};

/** Split a stored targets blob into a clean list. */
export function splitTargets(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Run one schedule: scan its targets, save NEW failed checks as findings on the
 * engagement (deduped against existing open findings of the same title), and
 * record the outcome on the schedule. Returns a short summary string.
 */
export async function runSchedule(s: Schedule): Promise<string> {
  const targets = splitTargets(s.targets);
  let summary: string;
  let added = 0;

  try {
    const results = await runScans(targets);

    // Existing open finding titles for this engagement — for dedup.
    const existing = await prisma.finding.findMany({
      where: { engagementId: s.engagementId, status: "open" },
      select: { title: true },
    });
    const seen = new Set(existing.map((f) => f.title));

    const data = results.flatMap((r) =>
      r.checks
        .filter((c) => !c.passed)
        .map((c) => {
          const title = `${c.name} — ${r.target}`;
          const description = `Scheduled posture scan of ${r.finalUrl ?? r.target}.\n\n${c.detail}`;
          return {
            engagementId: s.engagementId,
            title,
            severity: c.severity,
            description,
            recommendation: c.recommendation,
            ...classifyFinding({ title, description, severity: c.severity }),
          };
        })
        .filter((f) => {
          if (seen.has(f.title)) return false; // already tracked
          seen.add(f.title); // also dedup within this run
          return true;
        }),
    );

    if (data.length > 0) {
      await prisma.finding.createMany({ data });
      await prisma.engagement.update({
        where: { id: s.engagementId },
        data: { updatedAt: new Date() },
      });
      added = data.length;
    }
    summary = `Scanned ${targets.length} target(s); ${added} new finding(s).`;
  } catch (err) {
    summary = `Scan failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  await prisma.scheduledScan.update({
    where: { id: s.id },
    data: { lastRunAt: new Date(), lastStatus: summary },
  });
  return summary;
}

/** Run every enabled schedule whose interval has elapsed. Returns run count. */
export async function runDueSchedules(): Promise<{ ran: number; total: number }> {
  const enabled = await prisma.scheduledScan.findMany({ where: { enabled: true } });
  const now = Date.now();
  const due = enabled.filter((s) => isDue(s, now));
  for (const s of due) {
    await runSchedule(s);
  }
  return { ran: due.length, total: enabled.length };
}
