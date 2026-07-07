import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import type { AirsightEvent } from "@/lib/airsight-core";
import { TIERS, type Tier } from "@/lib/airsight-core";
import { mergeSightings, parseHistory, historySummary, toExport, EMPTY_HISTORY } from "@/lib/airsight-history-core";

export const dynamic = "force-dynamic";

async function loadHistory(email: string) {
  const row = await prisma.airsightLog.findUnique({ where: { ownerEmail: email } });
  if (!row?.data) return EMPTY_HISTORY;
  try {
    return parseHistory(JSON.parse(row.data));
  } catch {
    return EMPTY_HISTORY;
  }
}

/** Append a batch of canonical events to the owner's rolling AirSight history. */
export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const events: AirsightEvent[] = Array.isArray(body?.events) ? body.events.slice(0, 5000) : [];
  const tier: Tier = (["minimal", "standard", "full"] as Tier[]).includes(body?.tier) ? body.tier : "standard";
  const retentionMs = TIERS[tier].retentionDays * 86_400_000;

  const now = Date.now();
  const prev = await loadHistory(email);
  const next = mergeSightings(prev, events, now, retentionMs);

  await prisma.airsightLog.upsert({
    where: { ownerEmail: email },
    create: { ownerEmail: email, data: JSON.stringify(next) },
    update: { data: JSON.stringify(next) },
  });

  return NextResponse.json({ ok: true, summary: historySummary(next, now) });
}

/** Read the rolling history (or export it as JSON with ?export=json[&since=24h]). */
export async function GET(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const history = await loadHistory(email);
  const now = Date.now();

  if (url.searchParams.get("export") === "json") {
    const sinceMs = parseSince(url.searchParams.get("since"));
    const payload = toExport(history, sinceMs);
    return new NextResponse(payload, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="airsight-events-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  }

  return NextResponse.json({ history, summary: historySummary(history, now) });
}

/** Clear the owner's history. */
export async function DELETE() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prisma.airsightLog.deleteMany({ where: { ownerEmail: email } });
  return NextResponse.json({ ok: true });
}

/** Parse "24h" / "7d" / "30m" into ms (0 = all). */
function parseSince(s: string | null): number {
  if (!s) return 0;
  const m = /^(\d+)\s*([mhd])$/.exec(s.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  return n * (m[2] === "m" ? 60_000 : m[2] === "h" ? 3_600_000 : 86_400_000);
}
