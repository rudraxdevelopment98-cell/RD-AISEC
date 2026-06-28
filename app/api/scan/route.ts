import { NextResponse } from "next/server";
import { runScan } from "@/lib/scanner";
import { guardApi } from "@/lib/api-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function POST(req: Request) {
  const g = await guardApi("/dashboard/scan");
  if (g.res) return g.res;

  let target = "";
  try {
    const body = await req.json();
    target = String(body?.target ?? "").slice(0, 2048);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!target.trim()) {
    return NextResponse.json({ error: "A target URL is required" }, { status: 400 });
  }

  const result = await runScan(target);
  return NextResponse.json(result);
}
