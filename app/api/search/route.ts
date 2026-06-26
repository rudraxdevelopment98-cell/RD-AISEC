import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Quick-jump search: matches engagements and bug-bounty programs by name.
 * Section/nav matches are handled client-side. Auth required.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) return NextResponse.json({ engagements: [], programs: [] });

  const [engagements, programs] = await Promise.all([
    prisma.engagement.findMany({
      where: { name: { contains: q, mode: "insensitive" } },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: { id: true, name: true, type: true },
    }),
    prisma.bugProgram.findMany({
      where: { name: { contains: q, mode: "insensitive" } },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { id: true, name: true, engagementId: true },
    }),
  ]);

  return NextResponse.json({ engagements, programs });
}
