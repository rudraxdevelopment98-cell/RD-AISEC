import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Optional AI exploit/PoC drafting. Uses the Anthropic API only if
 * ANTHROPIC_API_KEY is set (the user's own key). Returns generated PoC code for
 * AUTHORIZED testing. Returns 400 with guidance if no key is configured.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "AI drafting isn't configured. Set ANTHROPIC_API_KEY in your environment to enable it." },
      { status: 400 },
    );
  }

  let body: { prompt?: unknown; language?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const prompt = String(body.prompt ?? "").slice(0, 4000);
  const language = String(body.language ?? "python").slice(0, 20);
  if (!prompt.trim()) return NextResponse.json({ error: "Describe what to build." }, { status: 400 });

  const system =
    "You are a security engineer assisting with AUTHORIZED penetration testing and bug-bounty work. " +
    "Write a minimal, clearly-commented proof-of-concept/exploit script for the requested issue. " +
    "Include a header comment stating it is for authorized testing only. Output ONLY the code in a single " +
    `${language} script — no prose, no markdown fences.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 1500,
        system,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return NextResponse.json({ error: `Anthropic API error ${res.status}: ${t.slice(0, 200)}` }, { status: 502 });
    }
    const data = await res.json();
    const code = (data?.content?.[0]?.text ?? "").replace(/^```[a-z]*\n?|```$/g, "").trim();
    return NextResponse.json({ code });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Request failed" },
      { status: 502 },
    );
  }
}
