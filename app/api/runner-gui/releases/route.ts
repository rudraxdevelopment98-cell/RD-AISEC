import { NextResponse } from "next/server";
import { fetchRunnerGuiReleases } from "@/lib/runner-gui-releases";

// Public: resolves direct-download URLs for the desktop app from GitHub Releases.
// Powers the portal download card (latest + version picker) and the in-GUI update
// check (the app compares its own version to `latest.version`). Cached at the edge
// so we don't hammer the GitHub API or hit its rate limit.
export const dynamic = "force-dynamic";
export const revalidate = 900;

export async function GET() {
  const releases = await fetchRunnerGuiReleases(12);
  const latest = releases[0] ?? null;
  return NextResponse.json(
    { latest, releases },
    {
      headers: {
        // Serve cached for 15 min, allow stale for an hour while revalidating.
        "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
      },
    },
  );
}
