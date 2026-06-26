import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { toCsv, slug } from "@/lib/csv";
import { MITRE_TACTICS, OWASP_TOP10 } from "@/data/frameworks";

const ATTACK_NAME = new Map(MITRE_TACTICS.map((t) => [t.id, t.name]));
const OWASP_NAME = new Map(OWASP_TOP10.map((o) => [o.id, o.name]));

/**
 * Export findings as CSV. Honors the same filters as the Findings page:
 *   ?engagement= &attack= &owasp= &severity= &status= &q=
 * With no filters, exports every finding across all engagements.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const p = url.searchParams;
  const where: Record<string, unknown> = {};
  if (p.get("engagement")) where.engagementId = p.get("engagement");
  if (p.get("attack")) where.attack = p.get("attack");
  if (p.get("owasp")) where.owasp = p.get("owasp");
  if (p.get("severity")) where.severity = p.get("severity");
  if (p.get("status")) where.status = p.get("status");
  if (p.get("q")) where.title = { contains: p.get("q"), mode: "insensitive" };

  const findings = await prisma.finding.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { engagement: { select: { name: true } } },
  });

  const headers = [
    "Title",
    "Severity",
    "Status",
    "ATT&CK ID",
    "ATT&CK Tactic",
    "OWASP ID",
    "OWASP Category",
    "Engagement",
    "Created",
    "Description",
    "Recommendation",
  ];
  const rows = findings.map((f) => [
    f.title,
    f.severity,
    f.status,
    f.attack,
    f.attack ? ATTACK_NAME.get(f.attack) ?? "" : "",
    f.owasp,
    f.owasp ? OWASP_NAME.get(f.owasp) ?? "" : "",
    f.engagement?.name ?? "",
    f.createdAt.toISOString(),
    f.description,
    f.recommendation,
  ]);

  const csv = toCsv(headers, rows);

  // Filename reflects the scope: per-engagement vs all, plus any framework filter.
  let name = "findings";
  if (p.get("engagement") && findings[0]?.engagement?.name) {
    name = `findings-${slug(findings[0].engagement.name)}`;
  } else if (p.get("attack")) name = `findings-attack-${p.get("attack")}`;
  else if (p.get("owasp")) name = `findings-owasp-${p.get("owasp")}`;
  else name = "findings-all";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
    },
  });
}
