import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateRunner } from "@/lib/runner-auth";

export const dynamic = "force-dynamic";

/**
 * A runner (which has internet egress) syncs a threat-intel feed here so the
 * portal always has current data without needing outbound access itself.
 * Body: { kind: "kev", cves: string[] }. Authenticated by the runner token.
 * Stored as one row per kind (comma-joined, deduped, capped CVE ids).
 */
export async function POST(req: Request) {
  const runner = await authenticateRunner(req);
  if (!runner) {
    return NextResponse.json({ error: "Invalid runner token" }, { status: 401 });
  }
  let body: { kind?: unknown; cves?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const kind = String(body.kind ?? "");
  if (kind !== "kev") {
    return NextResponse.json({ error: "Unknown feed kind" }, { status: 400 });
  }
  // Validate + dedupe CVE ids (defensive: only well-formed CVE strings, capped).
  const cves = Array.isArray(body.cves)
    ? Array.from(
        new Set(
          body.cves
            .map((c) => String(c).trim().toUpperCase())
            .filter((c) => /^CVE-\d{4}-\d{3,7}$/.test(c)),
        ),
      ).slice(0, 60000)
    : [];
  if (cves.length === 0) {
    return NextResponse.json({ error: "No valid CVE ids" }, { status: 400 });
  }
  const data = cves.join(",");
  await prisma.threatFeed.upsert({
    where: { kind },
    create: { kind, data, count: cves.length },
    update: { data, count: cves.length },
  });
  return NextResponse.json({ ok: true, kind, count: cves.length });
}
