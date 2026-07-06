import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { normalizePlan, defaultPlan } from "@/lib/floorplan-core";

export const dynamic = "force-dynamic";

/** Load the signed-in owner's home floor plan (or a default template). */
export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const row = await prisma.homePlan.findUnique({ where: { ownerEmail: email } });
  if (!row?.data) return NextResponse.json({ plan: defaultPlan(), saved: false });
  try {
    return NextResponse.json({ plan: normalizePlan(JSON.parse(row.data)), saved: true });
  } catch {
    return NextResponse.json({ plan: defaultPlan(), saved: false });
  }
}

/** Save the owner's home floor plan. Body: { plan: FloorPlan }. */
export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const plan = normalizePlan((body as { plan?: unknown })?.plan ?? body);
  const data = JSON.stringify(plan);

  await prisma.homePlan.upsert({
    where: { ownerEmail: email },
    create: { ownerEmail: email, data },
    update: { data },
  });
  return NextResponse.json({ ok: true, plan });
}
