import { NextResponse } from "next/server";
import { authenticateRunner } from "@/lib/runner-auth";
import { runnerToolSpecs } from "@/lib/runner-constants";

export const dynamic = "force-dynamic";

/**
 * The runner fetches its tool allowlist from here at startup (and periodically),
 * so new tools added to the portal work without re-pulling the runner script.
 * Authenticated by the runner bearer token. The binary must still be installed
 * on the runner host.
 */
export async function GET(req: Request) {
  const runner = await authenticateRunner(req);
  if (!runner) {
    return NextResponse.json({ error: "Invalid runner token" }, { status: 401 });
  }
  return NextResponse.json({ tools: runnerToolSpecs() });
}
