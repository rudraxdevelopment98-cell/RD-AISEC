// Load the learned outcome model from stored finding outcomes (server-side).
// Cheap, bounded read; safe to call per page render.

import { prisma } from "@/lib/db";
import { classifyFindingVuln } from "@/lib/vuln-taxonomy";
import { learnFromOutcomes, bucketOutcome, type OutcomeModel, type OutcomeRow } from "@/lib/engine/outcome-learning";

export async function loadOutcomeModel(): Promise<OutcomeModel> {
  const rows = await prisma.finding.findMany({
    where: { outcome: { notIn: ["", "pending"] } },
    select: { title: true, description: true, category: true, outcome: true, bountyAmount: true },
    take: 2000,
  });
  const mapped: OutcomeRow[] = rows.map((f) => ({
    cls: classifyFindingVuln({ title: f.title, description: f.description ?? "" })?.id ?? (f.category || "misc"),
    // Normalize the stored outcome string (casing / "not_applicable" vs
    // "not-applicable" / program-specific states) into a canonical Outcome so the
    // learner buckets wins and losses correctly.
    outcome: bucketOutcome(f.outcome),
    bountyAmount: f.bountyAmount ?? 0,
  }));
  return learnFromOutcomes(mapped);
}
