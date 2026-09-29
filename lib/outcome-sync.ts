// Poll HackerOne for the real-world OUTCOME of submitted reports and store it on
// the finding, so the engine can learn what actually pays. Runs from the daily
// cron. Bounded; best-effort (never throws into the cron).

import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { getReport, type H1Creds } from "@/lib/report/hackerone-api";
import { bucketOutcome } from "@/lib/engine/outcome-learning";

export async function syncHackerOneOutcomes(maxReports = 40): Promise<{ polled: number; updated: number }> {
  const integrations = await prisma.integration.findMany({
    where: { kind: "hackerone" },
    select: { ownerEmail: true, username: true, secret: true },
  });
  if (integrations.length === 0) return { polled: 0, updated: 0 };
  const credsByOwner = new Map<string, H1Creds>();
  for (const i of integrations) {
    try {
      credsByOwner.set(i.ownerEmail, { username: i.username, token: decryptSecret(i.secret) });
    } catch {
      /* skip a cred we can't decrypt */
    }
  }
  const anyCreds = [...credsByOwner.values()][0];
  if (!anyCreds) return { polled: 0, updated: 0 };

  // Reports whose outcome isn't final yet (or not yet fetched).
  const pending = await prisma.finding.findMany({
    where: {
      h1ReportId: { not: "" },
      OR: [{ outcome: "" }, { outcome: { in: ["pending", "triaged"] } }],
    },
    select: { id: true, h1ReportId: true, engagement: { select: { ownerEmail: true } } },
    orderBy: { submittedAt: "desc" },
    take: maxReports,
  });

  let polled = 0, updated = 0;
  for (const f of pending) {
    const owner = f.engagement?.ownerEmail || "";
    const creds = credsByOwner.get(owner) || anyCreds; // single-user: any owner's creds
    const res = await getReport(creds, f.h1ReportId);
    polled++;
    if (!res.ok) continue;
    const outcome = bucketOutcome(res.data.state);
    await prisma.finding
      .update({
        where: { id: f.id },
        data: {
          outcome,
          outcomeAt: new Date(),
          ...(res.data.bountyAmount > 0 ? { bountyAmount: res.data.bountyAmount } : {}),
        },
      })
      .catch(() => {});
    updated++;
  }
  return { polled, updated };
}
