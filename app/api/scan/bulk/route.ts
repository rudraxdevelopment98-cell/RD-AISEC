import { NextResponse } from "next/server";
import { runScans, parseTargets } from "@/lib/scanner";
import { guardApi } from "@/lib/api-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const g = await guardApi("/dashboard/scan");
  if (g.res) return g.res;

  let raw = "";
  try {
    const body = await req.json();
    raw = String(body?.targets ?? "").slice(0, 8192);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const targets = parseTargets(raw);
  if (targets.length === 0) {
    return NextResponse.json({ error: "Add at least one target URL" }, { status: 400 });
  }

  const results = await runScans(targets);
  return NextResponse.json({ results });
}
