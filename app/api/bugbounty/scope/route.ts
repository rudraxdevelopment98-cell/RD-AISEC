import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { fetchProgramScope } from "@/lib/scope-fetch";

export const dynamic = "force-dynamic";
// Scraping a program page (+ possible follow-up requests) can take a moment.
export const maxDuration = 30;

/**
 * Auto-fill a bug-bounty program's scope from its link. HackerOne uses the saved
 * API token (exact); Bugcrowd/others are scraped best-effort. Signed-in only.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url) {
    return NextResponse.json({ error: "Paste a program link first." }, { status: 400 });
  }

  // Reuse a saved HackerOne API token (if any) for exact H1 scope.
  let creds: { user: string; token: string } | undefined;
  try {
    const acct = await prisma.bugAccount.findFirst({
      where: { platform: "hackerone", apiUser: { not: "" }, apiToken: { not: "" } },
      select: { apiUser: true, apiToken: true },
    });
    if (acct?.apiUser && acct?.apiToken) {
      creds = { user: acct.apiUser, token: decryptSecret(acct.apiToken) };
    }
  } catch {
    /* no usable token — scrape instead */
  }

  try {
    const scope = await fetchProgramScope(url, creds);
    return NextResponse.json(scope);
  } catch {
    return NextResponse.json(
      { error: "Couldn't read scope from that link. Paste it manually." },
      { status: 502 },
    );
  }
}
