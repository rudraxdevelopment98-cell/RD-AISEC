import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { buildMarkdown, reportFilename } from "@/lib/report";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const engagement = await prisma.engagement.findUnique({
    where: { id: params.id },
    include: { findings: true },
  });
  if (!engagement) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const markdown = buildMarkdown(engagement);
  return new NextResponse(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${reportFilename(engagement)}"`,
    },
  });
}
