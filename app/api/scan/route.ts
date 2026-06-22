import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runScan } from "@/lib/scanner";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
