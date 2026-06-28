import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { authenticateRunner } from "@/lib/runner-auth";

export const dynamic = "force-dynamic";

/**
 * Serve the latest runner script so a runner can self-update. Authenticated by
 * the runner token. The runner compares the RUNNER_VERSION inside the returned
 * file to its own and, if newer, overwrites itself and restarts.
 */
export async function GET(req: Request) {
  const runner = await authenticateRunner(req);
  if (!runner) {
    return NextResponse.json({ error: "Invalid runner token" }, { status: 401 });
  }
  try {
    const p = path.join(process.cwd(), "runner", "rdaisec_runner.py");
    const content = await readFile(p, "utf8");
    return new NextResponse(content, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Runner script unavailable" }, { status: 404 });
  }
}
