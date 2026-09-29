// Load the learned outcome model from stored finding outcomes (server-side).
// Cheap, bounded read; safe to call per page render.

import { prisma } from "@/lib/db";
import { classifyFindingVuln } from "@/lib/vuln-taxonomy";
import { learnFromOutcomes, type OutcomeModel, type OutcomeRow, type Outcome } from "@/lib/engine/outcome-learning";

export async function loadOutcomeModel(): Promise<OutcomeModel> {
  const rows = await prisma.finding.findMany({
    where: { outcome: { notIn: ["", "pending"] } },
    select: { title: true, description: true, category: true, outcome: true, bountyAmount: true },
    take: 2000,
  });
  const mapped: OutcomeRow[] = rows.map((f) => ({
    cls: classifyFindingVuln({ title: f.title, description: f.description ?? "" })?.id ?? (f.category || "misc"),
    outcome: f.outcome as Outcome,
    bountyAmount: f.bountyAmount ?? 0,
  }));
  return learnFromOutcomes(mapped);
}
