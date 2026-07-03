import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildMarkdown, reportFilename } from "@/lib/report";
import { getKevSet } from "@/lib/threat-intel";
import { guardApi } from "@/lib/api-guard";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const g = await guardApi("/dashboard/engagements");
  if (g.res) return g.res;

  const engagement = await prisma.engagement.findUnique({
    where: { id: params.id },
    include: {
      findings: true,
      assessments: { include: { controls: { orderBy: { controlId: "asc" } } } },
      evidence: { orderBy: { acquiredAt: "desc" }, include: { custody: { orderBy: { at: "asc" } } } },
    },
  });
  if (!engagement) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const markdown = buildMarkdown(engagement, await getKevSet(), {
    assessments: engagement.assessments,
    evidence: engagement.evidence,
  });
  return new NextResponse(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${reportFilename(engagement)}"`,
    },
  });
}
